/**
 * eBay environment resolver (C10).
 *
 * Single source of truth for all EBAY_* environment variables.
 * Every other eBay file imports from here — no process.env access
 * is allowed elsewhere in the marketplace module. This keeps the
 * sandbox-vs-production switch in exactly one place.
 *
 * Design:
 *   - Pure functions, no global state, no NestJS DI. Imported by
 *     services and by the admin controller guard.
 *   - Fail-loud, but lazy: resolveEbayEnv() throws only when the
 *     caller actually needs eBay. Importing this module has zero
 *     side-effects, so the API boots even without EBAY_* set.
 *   - Sandbox defaults to placeholder URLs that will 404 gracefully
 *     if someone calls them without credentials — no silent hit on
 *     production by accident.
 */

export type EbayMode = 'sandbox' | 'production'

export interface EbayKeyset {
  mode: EbayMode
  appId: string
  devId: string
  certId: string
  ruName: string
}

export interface EbayEnv extends EbayKeyset {
  /** Base API URL for all REST calls. sandbox ≠ production. */
  apiBaseUrl: string
  /** Full URL the admin-UI redirects to for user-consent OAuth. */
  oauthAuthorizationUrl: string
  /** Token endpoint — accepts auth-code-grant and refresh-token-grant. */
  oauthTokenUrl: string
  /** Marketplace header value for Germany locale. Phase 2 is
   *  eBay.DE-only per user decision; extending requires a
   *  conscious schema change. */
  marketplaceId: 'EBAY_DE'
  /** Where user-consent lands after Authorize — must match RuName
   *  registered in developer.ebay.com. */
  redirectAcceptedCallbackPath: '/api/v1/admin/marketplaces/ebay/oauth-callback'
}

// Reference tables — eBay URLs are STABLE, hard-code them here
// rather than polluting .env with derivable values.
const SANDBOX_URLS = {
  apiBaseUrl: 'https://api.sandbox.ebay.com',
  oauthAuthorizationUrl: 'https://auth.sandbox.ebay.com/oauth2/authorize',
  oauthTokenUrl: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
} as const

const PRODUCTION_URLS = {
  apiBaseUrl: 'https://api.ebay.com',
  oauthAuthorizationUrl: 'https://auth.ebay.com/oauth2/authorize',
  oauthTokenUrl: 'https://api.ebay.com/identity/v1/oauth2/token',
} as const

export class EbayEnvConfigError extends Error {
  readonly code = 'EBAY_ENV_CONFIG_INVALID'
  readonly message3: { de: string; en: string; ar: string }
  constructor(missingVars: string[]) {
    const list = missingVars.join(', ')
    const en = `eBay environment incomplete. Missing: ${list}. Set them in apps/api/.env — see .env.example.`
    super(en)
    this.name = 'EbayEnvConfigError'
    this.message3 = {
      de: `eBay-Konfiguration unvollständig. Es fehlen: ${list}. Bitte in apps/api/.env setzen (siehe .env.example).`,
      en,
      ar: `إعدادات eBay غير مكتملة. المفقود: ${list}. يجب ضبطها في apps/api/.env (راجع .env.example).`,
    }
  }
}

/**
 * Decide sandbox-vs-production from env. Anything that is not
 * literally 'production' falls through to sandbox — safer default.
 */
export function resolveEbayMode(): EbayMode {
  const raw = (process.env.EBAY_ENV ?? '').trim().toLowerCase()
  return raw === 'production' ? 'production' : 'sandbox'
}

/**
 * Build the full eBay env for the currently-selected mode. Throws
 * EbayEnvConfigError listing every missing var — the 3-language
 * message lets the admin UI surface a single clear banner even for
 * multiple missing fields at once.
 *
 * Lazy: only called when eBay code actually needs it. Module
 * import of this file does not call this function.
 */
export function resolveEbayEnv(): EbayEnv {
  const mode = resolveEbayMode()

  const prefix = mode === 'sandbox' ? 'EBAY_SANDBOX' : 'EBAY_PRODUCTION'

  // Explicit env-var names — avoid fragile camelCase→SNAKE_CASE
  // derivation (RUNAME is a single token, not RU_NAME).
  const varMap: Record<'appId' | 'devId' | 'certId' | 'ruName', string> = {
    appId: `${prefix}_APP_ID`,
    devId: `${prefix}_DEV_ID`,
    certId: `${prefix}_CERT_ID`,
    ruName: `${prefix}_RUNAME`,
  }

  const vars = {
    appId: (process.env[varMap.appId] ?? '').trim(),
    devId: (process.env[varMap.devId] ?? '').trim(),
    certId: (process.env[varMap.certId] ?? '').trim(),
    ruName: (process.env[varMap.ruName] ?? '').trim(),
  }

  const missing: string[] = []
  for (const [k, v] of Object.entries(vars)) {
    if (!v || v.startsWith('replace-with-')) {
      missing.push(varMap[k as keyof typeof varMap])
    }
  }
  if (missing.length > 0) throw new EbayEnvConfigError(missing)

  const urls = mode === 'sandbox' ? SANDBOX_URLS : PRODUCTION_URLS
  return {
    mode,
    ...vars,
    ...urls,
    marketplaceId: 'EBAY_DE',
    redirectAcceptedCallbackPath: '/api/v1/admin/marketplaces/ebay/oauth-callback',
  }
}

/**
 * Lightweight check: returns null if env is fine, list of missing
 * vars otherwise. Used by the admin-UI status endpoint to render
 * a "config incomplete" banner WITHOUT actually throwing.
 */
export function probeEbayEnv(): { mode: EbayMode; missing: string[] } {
  try {
    const env = resolveEbayEnv()
    return { mode: env.mode, missing: [] }
  } catch (e) {
    if (e instanceof EbayEnvConfigError) {
      return { mode: resolveEbayMode(), missing: parseMissingFromError(e) }
    }
    throw e
  }
}

function parseMissingFromError(err: EbayEnvConfigError): string[] {
  // Extract the "Missing: X, Y, Z" tail of the English message. Keeps
  // the error type as the single source of truth for the list.
  const match = err.message.match(/Missing:\s*([^.]+)\./)
  if (!match) return []
  return match[1].split(',').map((s) => s.trim()).filter(Boolean)
}

/**
 * Test-only helper. Production code must never reach into raw env.
 */
export function __resolveEbayEnvForTest(overrides: NodeJS.ProcessEnv): EbayEnv {
  const saved = { ...process.env }
  try {
    Object.assign(process.env, overrides)
    return resolveEbayEnv()
  } finally {
    for (const k of Object.keys(overrides)) delete process.env[k]
    Object.assign(process.env, saved)
  }
}
