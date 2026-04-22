/**
 * C11b — EbayMerchantLocationService tests.
 *
 * Covers Meta-Verify targets:
 *   MV-1  Fresh run — GET 404 → POST creates → alreadyExisted=false
 *   MV-2  Idempotent rerun — GET 200 ENABLED → no writes
 *   MV-3  Disabled location — GET 200 DISABLED → enable call made
 *   MV-4  GET 5xx error propagates (not silent)
 *   MV-5  Address payload reads COMPANY_SHIP_* env vars correctly
 *         with fallbacks when env vars are absent
 *   MV-6  Settings persistence — patchSettings called with
 *         merchantLocationKey every run
 */

import { EbayMerchantLocationService, MALAK_MERCHANT_LOCATION_KEY } from '../ebay-merchant-location.service'
import type { FetchLike } from '../ebay-api.client'
import type { EbayAuthService } from '../ebay-auth.service'

async function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => Promise<T> | T): Promise<T> {
  const saved = { ...process.env }
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('EBAY_') || k.startsWith('COMPANY_SHIP_')) delete process.env[k]
  }
  Object.assign(process.env, env)
  try {
    return await fn()
  } finally {
    for (const k of Object.keys(env)) delete process.env[k]
    Object.assign(process.env, saved)
  }
}

const SANDBOX_ENV = {
  EBAY_ENV: 'sandbox',
  EBAY_SANDBOX_APP_ID: 'app',
  EBAY_SANDBOX_DEV_ID: 'dev',
  EBAY_SANDBOX_CERT_ID: 'cert',
  EBAY_SANDBOX_RUNAME: 'RUNAME',
}

function mkConfig(overrides: Record<string, string> = {}) {
  return {
    get: <T>(key: string, defaultValue?: T) => {
      if (key in overrides) return overrides[key] as unknown as T
      return (process.env[key] as unknown as T) ?? defaultValue
    },
  } as any
}

function mkFakeAuth(token = 'fake-bearer-token') {
  const patches: Array<Record<string, unknown>> = []
  return {
    getAccessTokenOrRefresh: async () => token,
    patchSettings: async (p: Record<string, unknown>) => {
      patches.push(p)
    },
    _patches: patches,
  } as unknown as EbayAuthService
}

function mkRoutingFetch(
  routes: Record<string, (init: RequestInit) => { status: number; body: string }>,
): { fetch: FetchLike; callLog: Array<{ method: string; url: string; body?: string }> } {
  const callLog: Array<{ method: string; url: string; body?: string }> = []
  const fetch: FetchLike = async (url, init) => {
    const method = init.method ?? 'GET'
    callLog.push({ method, url, body: init.body as string | undefined })
    const path = new URL(url).pathname + new URL(url).search
    const keys = Object.keys(routes).sort((a, b) => b.length - a.length)
    const match = keys.find((k) => path === k || path.startsWith(k))
    const route = match ? routes[match] : undefined
    const r = route ? route(init) : { status: 404, body: '{}' }
    return {
      status: r.status,
      headers: { get: () => null },
      text: async () => r.body,
      json: async () => (r.body ? JSON.parse(r.body) : {}),
    }
  }
  return { fetch, callLog }
}

const LOCATION_PATH = `/sell/inventory/v1/location/${MALAK_MERCHANT_LOCATION_KEY}`
const ENABLE_PATH = `${LOCATION_PATH}/enable`

// ──────────────────────────────────────────────────────────────

describe('EbayMerchantLocationService — MV-1 fresh run', () => {
  it('GET 404 → POST creates → alreadyExisted=false, wasDisabled=false', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const auth = mkFakeAuth()
      const svc = new EbayMerchantLocationService(mkConfig(), auth)
      const { fetch, callLog } = mkRoutingFetch({
        [LOCATION_PATH]: (init) => {
          if (init.method === 'GET') return { status: 404, body: '{"errors":[{"errorId":99999,"message":"not found"}]}' }
          return { status: 204, body: '' } // POST returns 204 No Content
        },
      })
      svc.__setFetchForTests(fetch)

      const result = await svc.ensureAutonomously()

      expect(result.locationKey).toBe(MALAK_MERCHANT_LOCATION_KEY)
      expect(result.alreadyExisted).toBe(false)
      expect(result.wasDisabled).toBe(false)

      // Exactly 2 calls: GET then POST
      expect(callLog).toHaveLength(2)
      expect(callLog[0].method).toBe('GET')
      expect(callLog[1].method).toBe('POST')

      // POST body is a valid location payload
      const body = JSON.parse(callLog[1].body!)
      expect(body.name).toBe('Malak Bekleidung Lager Berlin')
      expect(body.locationTypes).toEqual(['WAREHOUSE'])
      expect(body.location.address.country).toBe('DE')
      expect(body.location.address.city).toBe('Berlin')
      expect(body.location.address.postalCode).toBe('12047')
      expect(body.location.address.addressLine1).toBe('Pannierstr. 4')
      expect(body.location.address.stateOrProvince).toBe('Berlin')
    })
  })

  it('persists merchantLocationKey on settings after fresh create', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const auth = mkFakeAuth()
      const svc = new EbayMerchantLocationService(mkConfig(), auth)
      const { fetch } = mkRoutingFetch({
        [LOCATION_PATH]: (init) =>
          init.method === 'GET' ? { status: 404, body: '{}' } : { status: 204, body: '' },
      })
      svc.__setFetchForTests(fetch)

      await svc.ensureAutonomously()

      const patches = (auth as any)._patches
      expect(patches).toHaveLength(1)
      expect(patches[0]).toEqual({ merchantLocationKey: MALAK_MERCHANT_LOCATION_KEY })
    })
  })
})

describe('EbayMerchantLocationService — MV-2 idempotent rerun (already enabled)', () => {
  it('GET 200 ENABLED → no POST, alreadyExisted=true, wasDisabled=false', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const auth = mkFakeAuth()
      const svc = new EbayMerchantLocationService(mkConfig(), auth)
      const { fetch, callLog } = mkRoutingFetch({
        [LOCATION_PATH]: () => ({
          status: 200,
          body: JSON.stringify({
            merchantLocationKey: MALAK_MERCHANT_LOCATION_KEY,
            merchantLocationStatus: 'ENABLED',
            name: 'Malak Bekleidung Lager Berlin',
            location: { address: { city: 'Berlin', country: 'DE' } },
          }),
        }),
      })
      svc.__setFetchForTests(fetch)

      const result = await svc.ensureAutonomously()

      expect(result.alreadyExisted).toBe(true)
      expect(result.wasDisabled).toBe(false)

      // Exactly 1 GET, no POSTs
      expect(callLog).toHaveLength(1)
      expect(callLog[0].method).toBe('GET')
    })
  })

  it('tolerates missing merchantLocationStatus field (defaults to enabled)', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const auth = mkFakeAuth()
      const svc = new EbayMerchantLocationService(mkConfig(), auth)
      const { fetch, callLog } = mkRoutingFetch({
        [LOCATION_PATH]: () => ({
          status: 200,
          body: JSON.stringify({ merchantLocationKey: MALAK_MERCHANT_LOCATION_KEY }),
        }),
      })
      svc.__setFetchForTests(fetch)

      const result = await svc.ensureAutonomously()
      expect(result.alreadyExisted).toBe(true)
      expect(result.wasDisabled).toBe(false)
      expect(callLog).toHaveLength(1)
    })
  })
})

describe('EbayMerchantLocationService — MV-3 disabled → auto-enable', () => {
  it('GET 200 DISABLED → POST /enable, alreadyExisted=true, wasDisabled=true', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const auth = mkFakeAuth()
      const svc = new EbayMerchantLocationService(mkConfig(), auth)
      const { fetch, callLog } = mkRoutingFetch({
        [ENABLE_PATH]: () => ({ status: 204, body: '' }),
        [LOCATION_PATH]: () => ({
          status: 200,
          body: JSON.stringify({
            merchantLocationKey: MALAK_MERCHANT_LOCATION_KEY,
            merchantLocationStatus: 'DISABLED',
          }),
        }),
      })
      svc.__setFetchForTests(fetch)

      const result = await svc.ensureAutonomously()

      expect(result.alreadyExisted).toBe(true)
      expect(result.wasDisabled).toBe(true)

      // 1 GET + 1 enable POST, NO create POST
      expect(callLog).toHaveLength(2)
      expect(callLog[0].method).toBe('GET')
      expect(callLog[1].method).toBe('POST')
      expect(callLog[1].url).toContain('/enable')
    })
  })

  it('handles lowercase "disabled" status string', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const auth = mkFakeAuth()
      const svc = new EbayMerchantLocationService(mkConfig(), auth)
      const { fetch, callLog } = mkRoutingFetch({
        [ENABLE_PATH]: () => ({ status: 204, body: '' }),
        [LOCATION_PATH]: () => ({
          status: 200,
          body: JSON.stringify({ merchantLocationStatus: 'disabled' }),
        }),
      })
      svc.__setFetchForTests(fetch)

      const result = await svc.ensureAutonomously()
      expect(result.wasDisabled).toBe(true)
      expect(callLog.some((c) => c.url.includes('/enable'))).toBe(true)
    })
  })
})

describe('EbayMerchantLocationService — MV-4 error propagation', () => {
  it('GET 500 propagates (not silently treated as missing)', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const auth = mkFakeAuth()
      const svc = new EbayMerchantLocationService(mkConfig(), auth)
      const { fetch, callLog } = mkRoutingFetch({
        [LOCATION_PATH]: () => ({
          status: 500,
          body: JSON.stringify({ errors: [{ errorId: 20500, message: 'system error' }] }),
        }),
      })
      svc.__setFetchForTests(fetch)

      await expect(svc.ensureAutonomously()).rejects.toThrow()

      // No POST happened — we never treated 500 as "missing"
      expect(callLog.every((c) => c.method === 'GET')).toBe(true)

      // No settings patch either
      const patches = (auth as any)._patches
      expect(patches).toHaveLength(0)
    })
  })

  it('POST 400 on create propagates (not silently swallowed)', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const auth = mkFakeAuth()
      const svc = new EbayMerchantLocationService(mkConfig(), auth)
      const { fetch } = mkRoutingFetch({
        [LOCATION_PATH]: (init) =>
          init.method === 'GET'
            ? { status: 404, body: '{}' }
            : { status: 400, body: JSON.stringify({ errors: [{ errorId: 99, message: 'bad' }] }) },
      })
      svc.__setFetchForTests(fetch)

      await expect(svc.ensureAutonomously()).rejects.toThrow()
      // Settings should NOT be persisted on create failure
      const patches = (auth as any)._patches
      expect(patches).toHaveLength(0)
    })
  })
})

describe('EbayMerchantLocationService — MV-5 address payload from env', () => {
  it('reads COMPANY_SHIP_* env vars correctly', async () => {
    await withEnv(
      {
        ...SANDBOX_ENV,
        COMPANY_SHIP_STREET: 'Musterallee',
        COMPANY_SHIP_HOUSE: '99a',
        COMPANY_SHIP_PLZ: '10115',
        COMPANY_SHIP_CITY: 'München',
      },
      async () => {
        const auth = mkFakeAuth()
        // ConfigService.get reads process.env by default in tests via our mock
        const config = mkConfig()
        const svc = new EbayMerchantLocationService(config, auth)
        const { fetch, callLog } = mkRoutingFetch({
          [LOCATION_PATH]: (init) =>
            init.method === 'GET' ? { status: 404, body: '{}' } : { status: 204, body: '' },
        })
        svc.__setFetchForTests(fetch)

        await svc.ensureAutonomously()

        const postCall = callLog.find((c) => c.method === 'POST')!
        const body = JSON.parse(postCall.body!)
        expect(body.location.address.addressLine1).toBe('Musterallee 99a')
        expect(body.location.address.city).toBe('München')
        expect(body.location.address.postalCode).toBe('10115')
        // stateOrProvince is intentionally hardcoded even when city changes
        expect(body.location.address.stateOrProvince).toBe('Berlin')
        expect(body.location.address.country).toBe('DE')
      },
    )
  })

  it('falls back to Pannierstr. 4, 12047 Berlin when env vars absent', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const auth = mkFakeAuth()
      const svc = new EbayMerchantLocationService(mkConfig(), auth)
      const { fetch, callLog } = mkRoutingFetch({
        [LOCATION_PATH]: (init) =>
          init.method === 'GET' ? { status: 404, body: '{}' } : { status: 204, body: '' },
      })
      svc.__setFetchForTests(fetch)

      await svc.ensureAutonomously()
      const postCall = callLog.find((c) => c.method === 'POST')!
      const body = JSON.parse(postCall.body!)
      expect(body.location.address.addressLine1).toBe('Pannierstr. 4')
      expect(body.location.address.city).toBe('Berlin')
      expect(body.location.address.postalCode).toBe('12047')
    })
  })

  it('falls back on empty-string env vars (not just absence)', async () => {
    await withEnv(
      {
        ...SANDBOX_ENV,
        COMPANY_SHIP_STREET: '',
        COMPANY_SHIP_HOUSE: '   ',
        COMPANY_SHIP_PLZ: '',
        COMPANY_SHIP_CITY: '',
      },
      async () => {
        const auth = mkFakeAuth()
        const svc = new EbayMerchantLocationService(mkConfig(), auth)
        const { fetch, callLog } = mkRoutingFetch({
          [LOCATION_PATH]: (init) =>
            init.method === 'GET' ? { status: 404, body: '{}' } : { status: 204, body: '' },
        })
        svc.__setFetchForTests(fetch)

        await svc.ensureAutonomously()
        const postCall = callLog.find((c) => c.method === 'POST')!
        const body = JSON.parse(postCall.body!)
        // Defaults kick in despite env vars being set to empty/whitespace
        expect(body.location.address.addressLine1).toBe('Pannierstr. 4')
        expect(body.location.address.city).toBe('Berlin')
      },
    )
  })
})

describe('EbayMerchantLocationService — MV-6 settings persistence', () => {
  it('patches settings on every successful path (fresh create)', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const auth = mkFakeAuth()
      const svc = new EbayMerchantLocationService(mkConfig(), auth)
      const { fetch } = mkRoutingFetch({
        [LOCATION_PATH]: (init) =>
          init.method === 'GET' ? { status: 404, body: '{}' } : { status: 204, body: '' },
      })
      svc.__setFetchForTests(fetch)

      await svc.ensureAutonomously()
      const patches = (auth as any)._patches
      expect(patches[0]).toEqual({ merchantLocationKey: MALAK_MERCHANT_LOCATION_KEY })
    })
  })

  it('patches settings on idempotent rerun', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const auth = mkFakeAuth()
      const svc = new EbayMerchantLocationService(mkConfig(), auth)
      const { fetch } = mkRoutingFetch({
        [LOCATION_PATH]: () => ({
          status: 200,
          body: JSON.stringify({ merchantLocationStatus: 'ENABLED' }),
        }),
      })
      svc.__setFetchForTests(fetch)

      await svc.ensureAutonomously()
      const patches = (auth as any)._patches
      expect(patches[0]).toEqual({ merchantLocationKey: MALAK_MERCHANT_LOCATION_KEY })
    })
  })

  it('patches settings after re-enable', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const auth = mkFakeAuth()
      const svc = new EbayMerchantLocationService(mkConfig(), auth)
      const { fetch } = mkRoutingFetch({
        [ENABLE_PATH]: () => ({ status: 204, body: '' }),
        [LOCATION_PATH]: () => ({
          status: 200,
          body: JSON.stringify({ merchantLocationStatus: 'DISABLED' }),
        }),
      })
      svc.__setFetchForTests(fetch)

      await svc.ensureAutonomously()
      const patches = (auth as any)._patches
      expect(patches[0]).toEqual({ merchantLocationKey: MALAK_MERCHANT_LOCATION_KEY })
    })
  })
})
