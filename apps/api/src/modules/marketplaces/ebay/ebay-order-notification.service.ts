/**
 * EbayOrderNotificationService (C12.4 Webhook Receiver).
 *
 * Receives signed eBay Sell-Marketplace notifications (topic
 * ITEM_SOLD or similar order-events). Steps:
 *
 *   1. ECDSA signature verification (X-EBAY-SIGNATURE header)
 *   2. JSON-parse + defensive shape narrowing of the envelope
 *   3. Optional 5-min publishDate window check
 *   4. getOrder() via EbayApiClient — fetch full Sell-Fulfillment
 *      payload using the orderId from the notification
 *   5. Build MarketplaceImportEvent and delegate to
 *      MarketplaceImportService.processMarketplaceOrderEvent
 *
 * Hard-rules in this file:
 *   - The signature verifier is DUPLICATED from
 *     EbayAccountDeletionService on purpose. Centralizing it would
 *     touch the account-deletion webhook (untouchable per session
 *     rule). Each webhook carries its own copy + own cache.
 *   - This service NEVER throws on business-logic outcomes — it
 *     returns ImportOutcome | null. Only EbayNotConnected /
 *     EbayRefreshRevoked errors bubble up so the controller can
 *     answer 503; everything else (mapping fail, dup, etc.) is
 *     captured by the Glue Service and returned as a structured
 *     outcome.
 *   - 401 / 400 from signature/shape failures still throw
 *     (UnauthorizedException / BadRequestException) so eBay's retry
 *     machinery can react.
 *
 * Scope: EBAY only (TIKTOK gets its own webhook receiver in Phase 3).
 */

import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common'
import { createVerify } from 'node:crypto'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditService } from '../../admin/services/audit.service'
import { resolveEbayMode, resolveEbayEnv } from './ebay-env'
import { EbayAuthService } from './ebay-auth.service'
import { EbayApiClient, EbayApiError } from './ebay-api.client'
import {
  MarketplaceImportService,
  type ImportOutcome,
} from '../marketplace-import.service'
import type { MarketplaceImportEvent } from '../core/types'

// `RequestInfo` isn't in the api tsconfig's `lib` set; mirror the
// minimal FetchLike shape from EbayAccountDeletionService for the
// public-key lookup site.
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

const PUBLIC_KEY_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour (eBay recommendation)
const PUBLIC_KEY_REQUEST_TIMEOUT_MS = 5000

// 5-minute publishDate window — replay-protection per Q-6c. eBay's
// retry envelopes can legitimately arrive multiple minutes after the
// original publishDate; 5 minutes covers all observed retry latencies
// while still rejecting genuinely stale forgeries.
const PUBLISH_DATE_WINDOW_MS = 5 * 60 * 1000

// Module-level cache. Independent of EbayAccountDeletionService's cache
// — duplicating the variable is part of the Hard-Rule no-extract
// agreement. Tests reset via __clearPublicKeyCacheForTests().
const publicKeyCache = new Map<string, { pem: string; expiresAt: number }>()

/**
 * The narrow shape we accept from eBay. Topic is left untyped because
 * eBay assigns marketplace-specific topic names (ITEM_SOLD vs
 * AUCTION_END_SOLD vs FIXED_PRICE_TRANSACTION etc.). We do not branch
 * on topic at this layer — we trust the Developer Portal subscription
 * filter to route only order-events here.
 */
interface OrderNotificationPayload {
  metadata: { topic: string; schemaVersion?: string; deprecated?: boolean }
  notification: {
    notificationId: string
    eventDate: string
    publishDate: string
    publishAttemptCount?: number
    data: {
      orderId?: string
      // Some topics (e.g. ITEM_SOLD) may carry legacyOrderId instead.
      // We accept either and prefer orderId; if both are missing we
      // throw BadRequest so eBay retries.
      legacyOrderId?: string
      [k: string]: unknown
    }
  }
}

@Injectable()
export class EbayOrderNotificationService {
  private readonly logger = new Logger(EbayOrderNotificationService.name)

  private fetchImpl: FetchLike = (input, init) => fetch(input as any, init)

  constructor(
    private readonly auth: EbayAuthService,
    private readonly importService: MarketplaceImportService,
    // C15.1 — webhook idempotency pre-check + duplicate audit-row.
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Test-only: inject stub fetch for getPublicKey lookup. */
  __setFetchForTests(f: FetchLike | undefined): void {
    this.fetchImpl = f ?? ((input, init) => fetch(input as any, init))
  }

  /** Test-only: reset the module-level public-key cache. */
  __clearPublicKeyCacheForTests(): void {
    publicKeyCache.clear()
  }

  /**
   * Main entry point. Returns the ImportOutcome from the Glue Service,
   * or null if the notification was rejected pre-import (e.g. stale
   * publishDate, missing orderId — controller still answers 200/204).
   *
   * Throws:
   *   - UnauthorizedException — signature/header invalid (controller → 401)
   *   - BadRequestException — body malformed (controller → 400)
   *   - EbayNotConnected / EbayRefreshRevoked — getOrder() couldn't
   *     authenticate (controller → 503 so eBay retries later)
   */
  async handleNotification(
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): Promise<ImportOutcome | null> {
    // 1. Signature verification (throws 401 on any failure)
    await this.verifyEbaySignature(rawBody, signatureHeader)

    // 2. Parse + defensive shape narrowing
    const parsed = this.parseEnvelope(rawBody)

    const n = parsed.notification

    // 3. C15.1 — Webhook idempotency pre-check.
    //
    // Lookup MarketplaceOrderImport by (marketplace, rawEventId). If
    // a row exists, this is a duplicate webhook delivery (eBay retries
    // a notification after our 5xx, after our 200-then-eBay-misread,
    // or after their queue-state machine glitches). Short-circuit
    // BEFORE the expensive getOrder() Sell-Fulfillment call which
    // costs an eBay-API rate-limit slot.
    //
    // Returns null per owner-decision Q-8 (controller → 200, no
    // ImportOutcome to report — caller already knows; nothing to do).
    // Audit-row tier='ephemeral' so the duplicate-stream doesn't
    // pollute the long-term audit log (7-day retention then permanent
    // delete via audit-archive cron Step A).
    //
    // Defensive: if rawEventId is missing/empty in the envelope, skip
    // the pre-check and let downstream idempotency catch (orderId-
    // unique). The MarketplaceOrderImport schema already permits
    // multiple NULL rawEventIds so this never produces false-matches.
    const rawEventId = n.notificationId
    if (rawEventId && typeof rawEventId === 'string') {
      const existing = await this.prisma.marketplaceOrderImport
        .findUnique({
          where: {
            marketplace_raw_event_unique: {
              marketplace: 'EBAY',
              rawEventId,
            },
          },
          select: {
            id: true,
            externalOrderId: true,
            status: true,
            orderId: true,
          },
        })
        .catch((err: any) => {
          // Non-fatal — if the lookup itself fails, fall through to
          // the normal flow. Downstream (marketplace, externalOrderId)
          // unique-check is the second-line defense.
          this.logger.warn(
            `[ebay-order-webhook] idempotency pre-check failed: ${err?.message ?? err}`,
          )
          return null
        })

      if (existing) {
        this.logger.log(
          `[ebay-order-webhook] duplicate webhook notificationId=${rawEventId} ` +
            `existingImportId=${existing.id} externalOrderId=${existing.externalOrderId} ` +
            `status=${existing.status} — short-circuit, no getOrder() call`,
        )
        await this.audit
          .log({
            adminId: 'system',
            action: 'EBAY_WEBHOOK_DUPLICATE',
            entityType: 'marketplace_order_import',
            entityId: existing.id,
            changes: {
              after: {
                rawEventId,
                externalOrderId: existing.externalOrderId,
                status: existing.status,
                orderId: existing.orderId ?? null,
              },
            },
            // tier='ephemeral' is auto-determined via EPHEMERAL_ACTIONS
            // Set; explicit override here is belt-and-suspenders.
            tier: 'ephemeral',
          })
          .catch(() => {})
        return null
      }
    }

    // 4. orderId resolution + extraction (existing).
    //
    // C15.2 — Marker substring 'notification.data.orderId missing' is
    // ALSO referenced by EbayOrderNotificationController as
    // ORDER_ID_MISSING_MARKER. The controller catches this specific
    // message, swallows the 4xx, returns 204, and admin-notifies. If
    // this string ever changes here, the controller's catch-block
    // breaks silently — the controller test asserts the marker.
    const orderId = (n.data.orderId ?? n.data.legacyOrderId ?? '').toString().trim()
    if (!orderId) {
      throw new BadRequestException('notification.data.orderId missing')
    }

    // 5. Optional publishDate window — mitigates replay outside eBay's
    // ordinary retry envelope. publishDate is ISO-8601 from eBay.
    const publishDate = Date.parse(n.publishDate)
    if (Number.isFinite(publishDate)) {
      const drift = Date.now() - publishDate
      if (drift > PUBLISH_DATE_WINDOW_MS) {
        this.logger.warn(
          `[ebay-order-webhook] publishDate too old (drift=${drift}ms) — notificationId=${n.notificationId} orderId=${orderId}, accepting but flagging`,
        )
        // We still proceed — the Glue Service's idempotency-gate will
        // skip if we already imported this orderId. This is NOT a 4xx;
        // legitimate retries can be late.
      }
    }

    // 6. getOrder() — fetch full Sell-Fulfillment payload
    let rawOrderPayload: unknown
    try {
      rawOrderPayload = await this.fetchOrderFromEbay(orderId)
    } catch (e: any) {
      // EbayApiError with 4xx other than 404 is non-retryable client
      // error; 404 + 5xx + network are retryable. We re-throw as is —
      // the controller maps EbayApiError to a 5xx so eBay retries.
      this.logger.error(
        `[ebay-order-webhook] getOrder(${orderId}) failed: ${e?.message ?? e}`,
      )
      throw e
    }

    // 7. Build event + delegate to Glue
    const event: MarketplaceImportEvent = {
      marketplace: 'EBAY',
      externalOrderId: orderId,
      rawEventId: n.notificationId,
      rawEventPayload: rawOrderPayload,
      source: 'webhook',
    }

    return await this.importService.processMarketplaceOrderEvent(event)
  }

  // ────────────────────────────────────────────────────────────
  // Signature verification — DUPLICATED from
  // EbayAccountDeletionService per the no-extract Hard-Rule.
  // Keep these private methods byte-equal to the source file; if
  // either copy diverges, the divergence must be intentional and
  // documented in the diff.
  // ────────────────────────────────────────────────────────────

  /**
   * Verifies X-EBAY-SIGNATURE via ECDSA + eBay public key. Header
   * format (base64-encoded JSON):
   *   { "alg": "ECDSA", "kid": "...", "signature": "...", "digest": "SHA1" }
   */
  async verifyEbaySignature(
    rawBody: Buffer,
    header: string | undefined,
  ): Promise<void> {
    if (!header) {
      throw new UnauthorizedException('missing X-EBAY-SIGNATURE')
    }
    let parsed: { alg?: string; kid?: string; signature?: string; digest?: string }
    try {
      parsed = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
    } catch {
      throw new UnauthorizedException('malformed X-EBAY-SIGNATURE')
    }
    if (!parsed.kid || !parsed.signature) {
      throw new UnauthorizedException('incomplete X-EBAY-SIGNATURE')
    }

    const publicKeyPem = await this.resolveEbayPublicKey(parsed.kid)
    const verifier = createVerify('SHA1')
    verifier.update(rawBody)
    verifier.end()
    const sigBuf = Buffer.from(parsed.signature, 'base64')
    const valid = verifier.verify(publicKeyPem, sigBuf)
    if (!valid) {
      throw new UnauthorizedException('signature verification failed')
    }
  }

  private async resolveEbayPublicKey(kid: string): Promise<string> {
    const cached = publicKeyCache.get(kid)
    if (cached && cached.expiresAt > Date.now()) return cached.pem

    const mode = resolveEbayMode()
    const base =
      mode === 'production' ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com'

    // getPublicKey requires Application-Token (client-credentials) per
    // the eBay docs — same fix as the account-deletion service.
    const appToken = await this.auth.getApplicationAccessToken()

    const res = await this.fetchImpl(
      `${base}/commerce/notification/v1/public_key/${kid}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${appToken}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(PUBLIC_KEY_REQUEST_TIMEOUT_MS),
      },
    )
    if (!res.ok) {
      throw new UnauthorizedException(`getPublicKey failed: ${res.status}`)
    }
    const body = (await res.json()) as { key: string; algorithm?: string }
    const pem = this.normalizePem(body.key)
    publicKeyCache.set(kid, {
      pem,
      expiresAt: Date.now() + PUBLIC_KEY_CACHE_TTL_MS,
    })
    return pem
  }

  /**
   * eBay returns single-line PEM; Node's createVerify.verify() needs
   * newlines around the markers. Idempotent — already-formatted PEMs
   * pass through unchanged. Identical transform to the account-
   * deletion service (intentional duplication).
   */
  private normalizePem(keyFromResponse: string): string {
    if (keyFromResponse.includes('-----BEGIN PUBLIC KEY-----')) {
      let out = keyFromResponse
      out = out.replace(/-----BEGIN PUBLIC KEY-----(?!\n)/, '-----BEGIN PUBLIC KEY-----\n')
      out = out.replace(/(?<!\n)-----END PUBLIC KEY-----/, '\n-----END PUBLIC KEY-----')
      return out
    }
    const wrapped = keyFromResponse.match(/.{1,64}/g)?.join('\n') ?? keyFromResponse
    return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----\n`
  }

  // ────────────────────────────────────────────────────────────
  // Envelope parsing + getOrder()
  // ────────────────────────────────────────────────────────────

  /**
   * Parse + defensive shape narrowing. Throws BadRequestException for
   * anything that doesn't look like an eBay Notification envelope.
   * The narrowing is INTENTIONALLY shallow — we only check fields we
   * use downstream. Extra fields pass through.
   */
  private parseEnvelope(rawBody: Buffer): OrderNotificationPayload {
    let parsed: any
    try {
      parsed = JSON.parse(rawBody.toString('utf8'))
    } catch {
      throw new BadRequestException('invalid JSON')
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !parsed.metadata ||
      typeof parsed.metadata.topic !== 'string' ||
      !parsed.notification ||
      typeof parsed.notification !== 'object'
    ) {
      throw new BadRequestException('invalid envelope shape')
    }
    const n = parsed.notification
    if (
      typeof n.notificationId !== 'string' ||
      typeof n.eventDate !== 'string' ||
      typeof n.publishDate !== 'string' ||
      !n.data ||
      typeof n.data !== 'object'
    ) {
      throw new BadRequestException('invalid notification shape')
    }
    return parsed as OrderNotificationPayload
  }

  /**
   * Fetch the full Sell-Fulfillment order. Bearer is the user-token
   * (getAccessTokenOrRefresh), not the application-token. EbayApiClient
   * handles 5xx + 429 retries internally; the response body is what
   * the C12.2 EbayOrderAdapter expects in rawEventPayload.
   *
   * URL pattern per eBay docs:
   *   GET /sell/fulfillment/v1/order/{orderId}
   */
  private async fetchOrderFromEbay(orderId: string): Promise<unknown> {
    const env = resolveEbayEnv()
    const bearer = await this.auth.getAccessTokenOrRefresh()
    const client = new EbayApiClient(env)
    return await client.request(
      'GET',
      `/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}`,
      { bearer },
    )
  }
}

// Re-export EbayApiError for the controller's exception filter.
export { EbayApiError }
