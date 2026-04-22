/**
 * eBay low-level HTTP client (C10).
 *
 * Sits below every eBay service. Owns:
 *   - URL base + marketplace-id header for every call
 *   - Auth header (Basic for OAuth exchange, Bearer for Sell-API)
 *   - Structured error type `EbayApiError` the services branch on
 *   - Retry loop for 5xx + 429 with exponential backoff
 *   - Request-level timeout
 *
 * Does NOT own:
 *   - Token caching — EbayAuthService decides when to refresh and
 *     passes the Bearer into each call.
 *   - Business rules — services translate eBay shapes to our shapes.
 *   - DI — this class is a plain constructor with one optional
 *     fetch-impl injection for tests. Services (NestJS @Injectable)
 *     instantiate it via `new EbayApiClient(env)`.
 *
 * Test boundary (Phase-2 agreement):
 *   Unit tests inject a `FakeFetch` into the constructor — NO real
 *   HTTP ever fires in CI. Live-sandbox calls happen only from
 *   the dedicated smoke-* scripts.
 */

import type { EbayEnv } from './ebay-env'

// ──────────────────────────────────────────────────────────────
// Public surface
// ──────────────────────────────────────────────────────────────

export interface EbayRequestOptions {
  /** Bearer token (Sell-API calls). Omit for OAuth-token-exchange
   *  endpoints, which use Basic auth via `auth` below. */
  bearer?: string
  /** HTTP Basic pair for /identity/v1/oauth2/token. */
  auth?: { appId: string; certId: string }
  /** URL-encoded form body (OAuth) or JSON body (Sell-API). */
  body?: Record<string, string> | Record<string, unknown>
  bodyKind?: 'form' | 'json'
  /** Extra headers. Content-Type / Accept / marketplace-id are set
   *  automatically — pass only request-specific ones. */
  headers?: Record<string, string>
  /** Overrides the default request timeout (15s). */
  timeoutMs?: number
  /** Disable retry for this call. Defaults to true (retry on). */
  retry?: boolean
}

/**
 * Structured error every service catches. Carries:
 *   - `status` HTTP code (0 for network-level)
 *   - `ebayErrors` parsed error array from the response body
 *   - `retryable` flag so callers can decide to surface or retry
 */
export class EbayApiError extends Error {
  readonly code = 'EBAY_API_ERROR'
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly ebayErrors: Array<{
      errorId?: number
      domain?: string
      category?: string
      message?: string
      longMessage?: string
      parameters?: Array<{ name: string; value: string }>
    }> = [],
    readonly rawBody?: string,
  ) {
    super(message)
    this.name = 'EbayApiError'
  }
}

export type FetchLike = (
  url: string,
  init: RequestInit,
) => Promise<{
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
  json(): Promise<any>
}>

// ──────────────────────────────────────────────────────────────
// Client
// ──────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 15_000
const MAX_RETRIES = 3
const RETRY_BASE_MS = 400

export class EbayApiClient {
  constructor(
    private readonly env: EbayEnv,
    /** Inject for tests; defaults to global fetch. */
    private readonly fetchImpl: FetchLike = defaultFetch,
  ) {}

  /**
   * Execute a relative API path. Returns parsed JSON on success,
   * throws EbayApiError on any non-2xx (after retries for 5xx+429).
   *
   * `path` is prefixed with env.apiBaseUrl; pass something like
   * `/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_DE`.
   */
  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options: EbayRequestOptions = {},
  ): Promise<T> {
    const url = `${this.env.apiBaseUrl}${path}`
    const retry = options.retry !== false
    const maxAttempts = retry ? MAX_RETRIES : 1
    let lastErr: EbayApiError | undefined

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.doRequest<T>(method, url, options)
      } catch (e) {
        if (!(e instanceof EbayApiError)) throw e
        if (!e.retryable || attempt === maxAttempts) throw e
        lastErr = e
        await sleep(RETRY_BASE_MS * Math.pow(2, attempt - 1))
      }
    }
    // Unreachable — the loop throws on final attempt — but satisfies TS
    throw lastErr as EbayApiError
  }

  private async doRequest<T>(
    method: string,
    url: string,
    options: EbayRequestOptions,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Language': 'de-DE',
      'Accept-Language': 'de-DE',
      'X-EBAY-C-MARKETPLACE-ID': this.env.marketplaceId,
      ...options.headers,
    }

    if (options.bearer) {
      headers['Authorization'] = `Bearer ${options.bearer}`
    } else if (options.auth) {
      const basic = Buffer.from(`${options.auth.appId}:${options.auth.certId}`).toString('base64')
      headers['Authorization'] = `Basic ${basic}`
    }

    let body: string | undefined
    if (options.body !== undefined) {
      if (options.bodyKind === 'form') {
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
        body = new URLSearchParams(options.body as Record<string, string>).toString()
      } else {
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify(options.body)
      }
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let response
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      })
    } catch (e: any) {
      clearTimeout(timer)
      // Network-level failure — treat as retryable.
      throw new EbayApiError(
        `eBay request failed: ${e?.message ?? String(e)}`,
        0,
        true,
      )
    }
    clearTimeout(timer)

    const raw = await response.text()
    let parsed: any = undefined
    if (raw.length > 0) {
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = undefined
      }
    }

    if (response.status >= 200 && response.status < 300) {
      return parsed as T
    }

    // 429 (rate-limited) and 5xx — retryable.
    const retryable = response.status === 429 || response.status >= 500
    const errors = Array.isArray(parsed?.errors) ? parsed.errors : []
    const msg = errors[0]?.longMessage
      ?? errors[0]?.message
      ?? `eBay HTTP ${response.status}`
    throw new EbayApiError(msg, response.status, retryable, errors, raw)
  }
}

// ──────────────────────────────────────────────────────────────
// Default fetch implementation — globalThis.fetch (Node ≥18)
// ──────────────────────────────────────────────────────────────

const defaultFetch: FetchLike = async (url, init) => {
  const res = await fetch(url, init as any)
  return {
    status: res.status,
    headers: { get: (n: string) => res.headers.get(n) },
    text: () => res.text(),
    json: () => res.json(),
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
