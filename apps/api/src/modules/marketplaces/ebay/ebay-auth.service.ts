/**
 * eBay OAuth + Token-Lifecycle service (C10).
 *
 * Responsibilities:
 *   1. Build the user-consent URL for "eBay verbinden" button.
 *   2. Handle the OAuth callback — exchange auth-code for access +
 *      refresh tokens, envelope-encrypt both, store on
 *      SalesChannelConfig(channel='ebay').
 *   3. Refresh the access token before expiry (called by cron and
 *      on-demand by consumers).
 *   4. Decrypt + return the current Bearer token for the HTTP
 *      client. On refresh-token revoke (401): mark disconnected,
 *      notify admins, do NOT silently retry forever.
 *   5. Disconnect — zeroize tokens, mark isActive=false.
 *
 * The envelope-encryption helper from Phase-1 C2 is loaded LAZILY
 * here (user-decision Option 1a): if CHANNEL_TOKEN_MASTER_KEY is
 * missing, the API still boots; only actual token read/write fails
 * with a clear 3-language error.
 *
 * Null-touch guarantees:
 *   - No Orders / Payments / Invoices / Inventory / Reservations
 *     / Returns / Shipments read or written.
 *   - Only table touched: sales_channel_configs (already
 *     Phase-1 territory).
 */

import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import { PrismaService } from '../../../prisma/prisma.service'
import { resolveEbayEnv, type EbayEnv } from './ebay-env'
import { EbayApiClient, EbayApiError, type FetchLike } from './ebay-api.client'

// Permission-sensitive OAuth scopes eBay grants. Kept as a named
// constant so the admin runbook and the auth URL both reference
// the same list. Order is intentional (sell.account first — we
// need it for C10 sandbox-policy bootstrap).
export const EBAY_OAUTH_SCOPES: readonly string[] = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.finances',
  'https://api.ebay.com/oauth/api_scope/sell.marketing',
] as const

// Scope used for application-level (client-credentials) grant.
// Required for public endpoints like Commerce Notification getPublicKey
// and Commerce Taxonomy get_category_suggestions.
const EBAY_APPLICATION_SCOPE = 'https://api.ebay.com/oauth/api_scope'

// Safety margin: refresh the cached app token this many ms BEFORE
// eBay's declared expiry to avoid races with in-flight requests.
const APP_TOKEN_SAFETY_MARGIN_MS = 60_000

// Module-level cache. Single process + single set of app credentials →
// one token shared across every service that needs app-auth (deletion
// webhook today, Taxonomy matcher soon). Process restart resets it;
// one extra OAuth round-trip on first call is trivial.
const applicationTokenCache: { token: string | null; expiresAt: number } = {
  token: null,
  expiresAt: 0,
}

export interface EbayConnectionStatus {
  mode: 'sandbox' | 'production'
  connected: boolean
  tokenExpiresAt: Date | null
  refreshTokenExpiresAt: Date | null
  hasRefreshToken: boolean
  externalId: string | null // eBay seller username
  policyIds?: {
    fulfillmentPolicyId?: string
    returnPolicyId?: string
    paymentPolicyId?: string
  }
  missingEnvVars: string[]
  /**
   * If the master key env var is absent, encryption helper is
   * unusable and we cannot persist new tokens. Admin UI needs to
   * see this distinctly from missing eBay vars.
   */
  masterKeyMissing: boolean
}

@Injectable()
export class EbayAuthService {
  private readonly logger = new Logger(EbayAuthService.name)
  /**
   * Test-only: overrides the internal fetch impl the EbayApiClient
   * uses. Never set in production — the default (globalThis.fetch)
   * is what services get wired with.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private fetchOverrideForTests: FetchLike | undefined

  constructor(private readonly prisma: PrismaService) {}

  // ────────────────────────────────────────────────────────────
  // Public surface
  // ────────────────────────────────────────────────────────────

  /**
   * Build the full authorization URL. The admin UI redirects the
   * browser here; eBay sends the user back to our callback after
   * consent.
   */
  buildAuthorizeUrl(stateToken?: string): string {
    const env = this.mustResolveEnv()
    const state = stateToken ?? this.generateStateToken()

    // eBay wants scope as space-separated, then URL-encoded.
    const scope = EBAY_OAUTH_SCOPES.join(' ')
    const params = new URLSearchParams({
      client_id: env.appId,
      response_type: 'code',
      redirect_uri: env.ruName, // eBay accepts RuName here, NOT a URL
      scope,
      state,
    })
    return `${env.oauthAuthorizationUrl}?${params.toString()}`
  }

  /**
   * Step 2 of OAuth — exchange the authorization code we got on the
   * callback for a pair of tokens, encrypt them, persist on
   * sales_channel_configs(channel='ebay').
   *
   * Returns the decrypted access token so the caller (admin
   * controller) can optionally do a sanity call (e.g. getUser) to
   * confirm everything works. Admin UI should NOT expose this.
   */
  async handleCallback(authorizationCode: string, stateToken: string): Promise<{
    accessToken: string
    tokenExpiresAt: Date
    refreshTokenExpiresAt: Date
  }> {
    if (!authorizationCode?.trim()) {
      throw new BadRequestException({
        code: 'EBAY_OAUTH_MISSING_CODE',
        message: { de: 'Autorisierungscode fehlt.', en: 'Authorization code missing.', ar: 'رمز التفويض مفقود.' },
      })
    }
    if (!stateToken?.trim()) {
      throw new BadRequestException({
        code: 'EBAY_OAUTH_STATE_MISMATCH',
        message: {
          de: 'OAuth-State-Parameter fehlt oder ungültig.',
          en: 'OAuth state parameter missing or invalid.',
          ar: 'معلمة state الخاصة بـ OAuth مفقودة أو غير صالحة.',
        },
      })
    }

    const env = this.mustResolveEnv()
    const client = this.buildClient(env)

    const resp = await client.request<{
      access_token: string
      token_type: string
      expires_in: number
      refresh_token: string
      refresh_token_expires_in: number
    }>('POST', '/identity/v1/oauth2/token', {
      auth: { appId: env.appId, certId: env.certId },
      bodyKind: 'form',
      body: {
        grant_type: 'authorization_code',
        code: authorizationCode,
        redirect_uri: env.ruName,
      },
      retry: false, // auth-code is single-use; retry would double-spend
    })

    const { encryptChannelToken } = this.loadEncryption()
    const now = Date.now()
    const tokenExpiresAt = new Date(now + resp.expires_in * 1000)
    const refreshTokenExpiresAt = new Date(now + resp.refresh_token_expires_in * 1000)

    await this.prisma.salesChannelConfig.upsert({
      where: { channel: 'ebay' },
      create: {
        channel: 'ebay',
        isActive: true,
        accessToken: encryptChannelToken(resp.access_token),
        refreshToken: encryptChannelToken(resp.refresh_token),
        tokenExpiresAt,
        refreshTokenExpiresAt,
      },
      update: {
        isActive: true,
        accessToken: encryptChannelToken(resp.access_token),
        refreshToken: encryptChannelToken(resp.refresh_token),
        tokenExpiresAt,
        refreshTokenExpiresAt,
      },
    })

    return {
      accessToken: resp.access_token,
      tokenExpiresAt,
      refreshTokenExpiresAt,
    }
  }

  /**
   * Return a currently-valid access token, refreshing transparently
   * if within 2 minutes of expiry. Callers never need to think
   * about token lifetimes.
   *
   * Raises EbayNotConnectedError if no row exists yet. Raises
   * EbayRefreshRevokedError if eBay invalidated our refresh token
   * (invalid_grant) — connection is flipped to isActive=false and
   * admins are notified via the caller (this service returns the
   * error; the controller/cron chooses how to notify).
   */
  async getAccessTokenOrRefresh(): Promise<string> {
    const row = await this.prisma.salesChannelConfig.findUnique({
      where: { channel: 'ebay' },
    })
    if (!row) throw new EbayNotConnectedError()

    const { decryptChannelToken, encryptChannelToken } = this.loadEncryption()

    // Two-minute safety margin — if we're inside it, refresh NOW
    // rather than risk a mid-request expiry.
    const safetyMs = 120_000
    const stillValid =
      row.accessToken &&
      row.tokenExpiresAt &&
      row.tokenExpiresAt.getTime() - Date.now() > safetyMs

    if (stillValid) {
      try {
        return decryptChannelToken(row.accessToken!)
      } catch (e: any) {
        this.logger.error(
          `Failed to decrypt eBay access token — master key mismatch? ${e?.message ?? e}`,
        )
        throw new EbayNotConnectedError('token decrypt failure')
      }
    }

    if (!row.refreshToken) {
      throw new EbayNotConnectedError('no refresh token stored')
    }

    let refreshPlain: string
    try {
      refreshPlain = decryptChannelToken(row.refreshToken)
    } catch (e: any) {
      throw new EbayNotConnectedError('refresh token decrypt failure')
    }

    const env = this.mustResolveEnv()
    const client = this.buildClient(env)

    let resp: {
      access_token: string
      token_type: string
      expires_in: number
    }
    try {
      resp = await client.request('POST', '/identity/v1/oauth2/token', {
        auth: { appId: env.appId, certId: env.certId },
        bodyKind: 'form',
        body: {
          grant_type: 'refresh_token',
          refresh_token: refreshPlain,
          scope: EBAY_OAUTH_SCOPES.join(' '),
        },
        retry: false,
      })
    } catch (e) {
      if (e instanceof EbayApiError) {
        const isRevoked =
          e.status === 401 ||
          e.ebayErrors.some((x) => (x.message ?? '').toLowerCase().includes('invalid_grant'))
        if (isRevoked) {
          await this.markRevoked()
          throw new EbayRefreshRevokedError()
        }
      }
      throw e
    }

    const newExpiry = new Date(Date.now() + resp.expires_in * 1000)
    await this.prisma.salesChannelConfig.update({
      where: { channel: 'ebay' },
      data: {
        accessToken: encryptChannelToken(resp.access_token),
        tokenExpiresAt: newExpiry,
      },
    })
    return resp.access_token
  }

  /**
   * Get an application-level OAuth token via client-credentials grant.
   *
   * DIFFERENT from getAccessTokenOrRefresh() which returns the USER
   * OAuth token (authorization-code flow, merchant's account). Some
   * eBay endpoints — notably Commerce Notification getPublicKey and
   * Commerce Taxonomy get_category_suggestions — require an app-level
   * token instead. Same app+cert credentials, different grant type.
   *
   * Caching: module-level `applicationTokenCache`, TTL = expires_in
   * minus 60s safety margin (matches the User-token-refresh pattern
   * above). Future consumers (Taxonomy matcher) share the same cache.
   *
   * Throws EbayEnvConfigError if credentials aren't configured for
   * the current EBAY_ENV (same fail-loud as the user-flow).
   */
  async getApplicationAccessToken(): Promise<string> {
    const now = Date.now()
    if (applicationTokenCache.token && applicationTokenCache.expiresAt > now) {
      return applicationTokenCache.token
    }

    const env = this.mustResolveEnv()
    const client = this.buildClient(env)

    const resp = await client.request<{
      access_token: string
      token_type: string
      expires_in: number
    }>('POST', '/identity/v1/oauth2/token', {
      auth: { appId: env.appId, certId: env.certId },
      bodyKind: 'form',
      body: {
        grant_type: 'client_credentials',
        scope: EBAY_APPLICATION_SCOPE,
      },
      retry: true, // idempotent fetch — safe to retry on 5xx/429
    })

    applicationTokenCache.token = resp.access_token
    applicationTokenCache.expiresAt = now + resp.expires_in * 1000 - APP_TOKEN_SAFETY_MARGIN_MS
    return resp.access_token
  }

  /** Test-only: flush the module-level application-token cache. */
  __clearApplicationTokenCacheForTests(): void {
    applicationTokenCache.token = null
    applicationTokenCache.expiresAt = 0
  }

  /**
   * Connection status for the admin UI. Never throws — returns
   * structured flags so the UI can surface each condition distinctly.
   */
  async getStatus(): Promise<EbayConnectionStatus> {
    // Probe env without throwing (admin UI renders a banner
    // listing missing vars).
    let env: EbayEnv | null = null
    const missing: string[] = []
    try {
      env = resolveEbayEnv()
    } catch (e: any) {
      // Parse missing list from structured error.
      if (Array.isArray(e?.message3)) {
        // no-op — message3 is an object
      }
      const m = /Missing:\s*([^.]+)\./.exec(e?.message ?? '')
      if (m) missing.push(...m[1].split(',').map((s: string) => s.trim()))
    }

    // Master-key probe — require the helper and attempt a round-
    // trip. loadEncryption() itself doesn't throw on missing key
    // (it only returns the function refs); the throw happens on
    // first call. Do the call here to surface the condition.
    let masterKeyMissing = false
    try {
      const enc = this.loadEncryption()
      // Round-trip cheap string — throws if KEK is absent.
      const sentinel = enc.encryptChannelToken('probe')
      if (!sentinel) masterKeyMissing = true
    } catch {
      masterKeyMissing = true
    }

    const row = await this.prisma.salesChannelConfig.findUnique({ where: { channel: 'ebay' } })

    const settings = (row?.settings ?? {}) as {
      policyIds?: EbayConnectionStatus['policyIds']
      externalId?: string
    }

    return {
      mode: env?.mode ?? ((process.env.EBAY_ENV ?? '').toLowerCase() === 'production' ? 'production' : 'sandbox'),
      connected: Boolean(row?.isActive && row.accessToken),
      tokenExpiresAt: row?.tokenExpiresAt ?? null,
      refreshTokenExpiresAt: row?.refreshTokenExpiresAt ?? null,
      hasRefreshToken: Boolean(row?.refreshToken),
      externalId: row?.externalId ?? settings.externalId ?? null,
      policyIds: settings.policyIds,
      missingEnvVars: missing,
      masterKeyMissing,
    }
  }

  /**
   * Clear stored tokens and mark inactive. Does NOT call eBay —
   * there is no revoke-endpoint for RuName-granted tokens; revoking
   * is done by the seller in their eBay account if they wish to go
   * further. Idempotent.
   */
  async disconnect(): Promise<void> {
    const row = await this.prisma.salesChannelConfig.findUnique({ where: { channel: 'ebay' } })
    if (!row) return

    await this.prisma.salesChannelConfig.update({
      where: { channel: 'ebay' },
      data: {
        isActive: false,
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        refreshTokenExpiresAt: null,
      },
    })
  }

  /**
   * Stable handle for EbaySandboxPoliciesService to persist policy
   * IDs into settings JSON without duplicating the JSON-merge logic.
   */
  async patchSettings(patch: Record<string, unknown>): Promise<void> {
    const row = await this.prisma.salesChannelConfig.findUnique({ where: { channel: 'ebay' } })
    if (!row) throw new EbayNotConnectedError()
    const prev = (row.settings ?? {}) as Record<string, unknown>
    await this.prisma.salesChannelConfig.update({
      where: { channel: 'ebay' },
      data: { settings: { ...prev, ...patch } as any },
    })
  }

  // ────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────

  private mustResolveEnv(): EbayEnv {
    try {
      return resolveEbayEnv()
    } catch (e: any) {
      // Rethrow as 400-equivalent so callers in admin controllers
      // turn it into a clean user-facing error instead of a 500.
      throw new BadRequestException({
        code: e?.code ?? 'EBAY_ENV_CONFIG_INVALID',
        message: e?.message3 ?? { de: e?.message, en: e?.message, ar: e?.message },
      })
    }
  }

  private buildClient(env: EbayEnv): EbayApiClient {
    return this.fetchOverrideForTests
      ? new EbayApiClient(env, this.fetchOverrideForTests)
      : new EbayApiClient(env)
  }

  /**
   * Dynamic import of the encryption helper so import of this
   * service file never throws at module-eval even if the master
   * key env var is absent (user-decision Option 1a).
   */
  private loadEncryption(): {
    encryptChannelToken(v: string): string
    decryptChannelToken(v: string): string
  } {
    // require() keeps this synchronous — jest + ts-node both resolve it.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../../../common/helpers/channel-token-encryption')
    return {
      encryptChannelToken: mod.encryptChannelToken,
      decryptChannelToken: mod.decryptChannelToken,
    }
  }

  private generateStateToken(): string {
    // 32 bytes, URL-safe base64. Stored in settings JSON so the
    // callback can verify. Replay risk: mitigated by single-use +
    // 10-minute expiry (enforced by caller — stored with a
    // timestamp and cleared on callback).
    return randomBytes(32).toString('base64url')
  }

  private async markRevoked(): Promise<void> {
    await this.prisma.salesChannelConfig.updateMany({
      where: { channel: 'ebay' },
      data: {
        isActive: false,
        accessToken: null,
        tokenExpiresAt: null,
      },
    })
  }

  /**
   * Test hook: lets the spec file inject a FakeFetch without
   * mutating the environment.
   */
  __setFetchForTests(f: FetchLike | undefined): void {
    this.fetchOverrideForTests = f
  }

}

// ──────────────────────────────────────────────────────────────
// Service-layer error types
// ──────────────────────────────────────────────────────────────

export class EbayNotConnectedError extends Error {
  readonly code = 'EBAY_NOT_CONNECTED'
  readonly message3: { de: string; en: string; ar: string }
  constructor(reason = 'not connected') {
    super(reason)
    this.name = 'EbayNotConnectedError'
    this.message3 = {
      de: 'eBay ist noch nicht verbunden. Bitte in /admin/channels den Button "eBay verbinden" anklicken.',
      en: 'eBay is not connected yet. Click "Connect eBay" in /admin/channels.',
      ar: 'لم يتم الاتصال بـ eBay بعد. يرجى النقر على زر "ربط eBay" في /admin/channels.',
    }
  }
}

export class EbayRefreshRevokedError extends Error {
  readonly code = 'EBAY_REFRESH_REVOKED'
  readonly message3: { de: string; en: string; ar: string }
  constructor() {
    super('refresh token revoked')
    this.name = 'EbayRefreshRevokedError'
    this.message3 = {
      de: 'eBay-Authorisierung wurde widerrufen. Bitte eBay erneut verbinden.',
      en: 'eBay authorization was revoked. Please reconnect eBay.',
      ar: 'تم إلغاء تفويض eBay. يرجى إعادة الاتصال بـ eBay.',
    }
  }
}

/**
 * Narrow mapping of service-layer errors to NestJS exceptions —
 * controllers call this to turn our typed errors into 4xx responses
 * with the 3-language payload shape the admin UI expects.
 */
export function mapEbayErrorToHttp(e: unknown): never {
  if (e instanceof EbayNotConnectedError) {
    throw new ForbiddenException({ code: e.code, message: e.message3 })
  }
  if (e instanceof EbayRefreshRevokedError) {
    throw new ForbiddenException({ code: e.code, message: e.message3 })
  }
  throw e as Error
}
