/**
 * C10 — EbayApiClient tests.
 *
 * FakeFetch-driven — zero real HTTP. Validates:
 *   - URL assembly (baseUrl + path)
 *   - Marketplace + accept-language headers always set
 *   - Bearer vs Basic auth switch
 *   - Form vs JSON body encoding
 *   - Retry on 5xx + 429 up to 3 attempts with backoff short-circuited
 *   - Non-retryable 4xx bubbles through after first attempt
 *   - Structured EbayApiError with parsed errors array
 */

import { EbayApiClient, EbayApiError, type FetchLike } from '../ebay-api.client'
import type { EbayEnv } from '../ebay-env'

function mkEnv(): EbayEnv {
  return {
    mode: 'sandbox',
    appId: 'app-1',
    devId: 'dev-1',
    certId: 'cert-1',
    ruName: 'RU',
    apiBaseUrl: 'https://api.sandbox.ebay.com',
    oauthAuthorizationUrl: 'https://auth.sandbox.ebay.com/oauth2/authorize',
    oauthTokenUrl: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
    marketplaceId: 'EBAY_DE',
    redirectAcceptedCallbackPath: '/api/v1/admin/marketplaces/ebay/oauth-callback',
  }
}

function mkFakeFetch(
  handler: (url: string, init: RequestInit) => {
    status: number
    body?: string
    headers?: Record<string, string>
  },
): { fetch: FetchLike; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init })
    const r = handler(url, init)
    return {
      status: r.status,
      headers: { get: (n: string) => (r.headers ?? {})[n.toLowerCase()] ?? null },
      text: async () => r.body ?? '',
      json: async () => (r.body ? JSON.parse(r.body) : {}),
    }
  }
  return { fetch, calls }
}

describe('EbayApiClient — URL + headers', () => {
  it('prepends apiBaseUrl to path and sets marketplace + language headers', async () => {
    const { fetch, calls } = mkFakeFetch(() => ({ status: 200, body: '{"ok":true}' }))
    const client = new EbayApiClient(mkEnv(), fetch)
    await client.request('GET', '/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_DE', {
      bearer: 'tok',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.sandbox.ebay.com/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_DE')
    const h = calls[0].init.headers as Record<string, string>
    expect(h['Authorization']).toBe('Bearer tok')
    expect(h['X-EBAY-C-MARKETPLACE-ID']).toBe('EBAY_DE')
    expect(h['Accept-Language']).toBe('de-DE')
    expect(h['Content-Language']).toBe('de-DE')
  })

  it('uses Basic auth when auth is passed and no bearer', async () => {
    const { fetch, calls } = mkFakeFetch(() => ({ status: 200, body: '{}' }))
    const client = new EbayApiClient(mkEnv(), fetch)
    await client.request('POST', '/identity/v1/oauth2/token', {
      auth: { appId: 'A', certId: 'C' },
      bodyKind: 'form',
      body: { grant_type: 'authorization_code' },
    })
    const h = calls[0].init.headers as Record<string, string>
    expect(h['Authorization']).toMatch(/^Basic /)
    expect(h['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(calls[0].init.body).toContain('grant_type=authorization_code')
  })

  it('serializes JSON body with Content-Type: application/json', async () => {
    const { fetch, calls } = mkFakeFetch(() => ({ status: 201, body: '{"id":"X"}' }))
    const client = new EbayApiClient(mkEnv(), fetch)
    await client.request('POST', '/sell/account/v1/fulfillment_policy', {
      bearer: 'tok',
      bodyKind: 'json',
      body: { name: 'P1' },
    })
    const h = calls[0].init.headers as Record<string, string>
    expect(h['Content-Type']).toBe('application/json')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ name: 'P1' })
  })
})

describe('EbayApiClient — retry + error handling', () => {
  it('retries on 500 up to 3 attempts total, then throws', async () => {
    let n = 0
    const { fetch, calls } = mkFakeFetch(() => {
      n++
      return { status: 500, body: '{"errors":[{"message":"internal"}]}' }
    })
    const client = new EbayApiClient(mkEnv(), fetch)
    await expect(
      client.request('GET', '/ping', { bearer: 'tok' }),
    ).rejects.toBeInstanceOf(EbayApiError)
    expect(calls).toHaveLength(3)
    expect(n).toBe(3)
  })

  it('retries on 429 rate-limit', async () => {
    const responses: Array<{ status: number; body: string }> = [
      { status: 429, body: '{"errors":[{"message":"rate limited"}]}' },
      { status: 200, body: '{"ok":true}' },
    ]
    let i = 0
    const { fetch, calls } = mkFakeFetch(() => responses[i++])
    const client = new EbayApiClient(mkEnv(), fetch)
    const result = await client.request<{ ok: true }>('GET', '/x', { bearer: 't' })
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(2)
  })

  it('does NOT retry on 400 or 401 (non-retryable)', async () => {
    const { fetch, calls } = mkFakeFetch(() => ({
      status: 400,
      body: '{"errors":[{"errorId":1,"message":"invalid"}]}',
    }))
    const client = new EbayApiClient(mkEnv(), fetch)
    try {
      await client.request('GET', '/x', { bearer: 't' })
      fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(EbayApiError)
      const err = e as EbayApiError
      expect(err.status).toBe(400)
      expect(err.retryable).toBe(false)
      expect(err.ebayErrors[0].errorId).toBe(1)
    }
    expect(calls).toHaveLength(1)
  })

  it('respects retry:false override', async () => {
    const { fetch, calls } = mkFakeFetch(() => ({ status: 500, body: '{}' }))
    const client = new EbayApiClient(mkEnv(), fetch)
    await expect(
      client.request('POST', '/identity/v1/oauth2/token', { retry: false }),
    ).rejects.toBeInstanceOf(EbayApiError)
    expect(calls).toHaveLength(1)
  })

  it('turns a network-level throw into EbayApiError with status=0 and retryable=true', async () => {
    let n = 0
    const fetch: FetchLike = async () => {
      n++
      throw new Error('ECONNRESET')
    }
    const client = new EbayApiClient(mkEnv(), fetch)
    await expect(client.request('GET', '/x', { bearer: 't' })).rejects.toMatchObject({
      status: 0,
      retryable: true,
    })
    expect(n).toBe(3)
  })
})
