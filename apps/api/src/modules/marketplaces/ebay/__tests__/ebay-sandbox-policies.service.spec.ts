/**
 * C10 — EbaySandboxPoliciesService tests.
 *
 * Covers Meta-Verify targets:
 *   MV-3  Second bootstrap run detects existing policies, returns
 *         their IDs without POSTing duplicates (idempotency)
 *   MV-4  Bootstrap with EBAY_ENV=production → ForbiddenException
 *         ('SandboxOnly') + no HTTP calls made
 *
 * Uses a FakeFetch to stand in for the eBay API; a Fake EbayAuthService
 * handles token + settings persistence in memory.
 */

import { EbaySandboxPoliciesService } from '../ebay-sandbox-policies.service'
import type { FetchLike } from '../ebay-api.client'
import type { EbayAuthService } from '../ebay-auth.service'

async function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => Promise<T> | T): Promise<T> {
  const saved = { ...process.env }
  for (const k of Object.keys(process.env)) if (k.startsWith('EBAY_')) delete process.env[k]
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

const PRODUCTION_ENV = {
  EBAY_ENV: 'production',
  EBAY_PRODUCTION_APP_ID: 'pa',
  EBAY_PRODUCTION_DEV_ID: 'pd',
  EBAY_PRODUCTION_CERT_ID: 'pc',
  EBAY_PRODUCTION_RUNAME: 'PR',
}

function mkFakeAuth(tokenString = 'fake-bearer-token'): EbayAuthService {
  const settingsPatches: Array<Record<string, unknown>> = []
  return {
    getAccessTokenOrRefresh: async () => tokenString,
    patchSettings: async (p: Record<string, unknown>) => {
      settingsPatches.push(p)
    },
    // expose for assertions
    _patches: settingsPatches,
  } as any
}

/**
 * Fake EbayMerchantLocationService for sandbox-policies tests.
 * Returns a deterministic success result without making any HTTP
 * calls. Real merchant-location behaviour is covered by its own
 * spec file; these tests only need the method to exist + return
 * a well-formed shape so bootstrap can build its result.
 */
function mkFakeMerchantLocation(alreadyExisted = false) {
  const calls: number[] = []
  return {
    ensureMerchantLocation: async () => {
      calls.push(Date.now())
      return {
        locationKey: 'malak-lager-berlin',
        alreadyExisted,
        wasDisabled: false,
      }
    },
    _calls: calls,
  } as any
}

/**
 * Fake-fetch that routes by path. Each call returns what the
 * per-path handler gives it; absence → 404 empty.
 */
function mkRoutingFetch(
  routes: Record<string, (init: RequestInit) => { status: number; body: string }>,
): { fetch: FetchLike; callLog: Array<{ method: string; url: string; body?: string }> } {
  const callLog: Array<{ method: string; url: string; body?: string }> = []
  const fetch: FetchLike = async (url, init) => {
    const method = init.method ?? 'GET'
    callLog.push({ method, url, body: init.body as string | undefined })
    // Match the longest prefix registered
    const path = new URL(url).pathname + new URL(url).search
    const keys = Object.keys(routes).sort((a, b) => b.length - a.length)
    const match = keys.find((k) => path.startsWith(k))
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

describe('EbaySandboxPoliciesService — MV-4 production guard', () => {
  it('rejects with SandboxOnly in production env and makes no HTTP calls', async () => {
    await withEnv(PRODUCTION_ENV, async () => {
      const fakeAuth = mkFakeAuth()
      const svc = new EbaySandboxPoliciesService(fakeAuth, mkFakeMerchantLocation())
      const { fetch, callLog } = mkRoutingFetch({})
      svc.__setFetchForTests(fetch)

      await expect(svc.bootstrapPolicies()).rejects.toMatchObject({
        response: {
          code: 'EBAY_SANDBOX_ONLY',
        },
      })
      // No policy list call, no POST — hard guard engaged BEFORE auth/HTTP
      expect(callLog).toHaveLength(0)
    })
  })
})

describe('EbaySandboxPoliciesService — create-fresh path', () => {
  it('creates all three policies when none exist and persists IDs to settings', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const fakeAuth = mkFakeAuth()
      const svc = new EbaySandboxPoliciesService(fakeAuth, mkFakeMerchantLocation())

      const { fetch, callLog } = mkRoutingFetch({
        // Pre-step: opt-in succeeds fresh (200 OK, no errors).
        '/sell/account/v1/program/opt_in': () => ({ status: 200, body: '{}' }),
        '/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_DE': () => ({
          status: 200,
          body: JSON.stringify({ fulfillmentPolicies: [] }),
        }),
        '/sell/account/v1/fulfillment_policy': () => ({
          status: 201,
          body: JSON.stringify({ fulfillmentPolicyId: 'F-1' }),
        }),
        '/sell/account/v1/return_policy?marketplace_id=EBAY_DE': () => ({
          status: 200,
          body: JSON.stringify({ returnPolicies: [] }),
        }),
        '/sell/account/v1/return_policy': () => ({
          status: 201,
          body: JSON.stringify({ returnPolicyId: 'R-1' }),
        }),
        '/sell/account/v1/payment_policy?marketplace_id=EBAY_DE': () => ({
          status: 200,
          body: JSON.stringify({ paymentPolicies: [] }),
        }),
        '/sell/account/v1/payment_policy': () => ({
          status: 201,
          body: JSON.stringify({ paymentPolicyId: 'P-1' }),
        }),
      })
      svc.__setFetchForTests(fetch)

      const result = await svc.bootstrapPolicies()

      expect(result.fulfillmentPolicyId).toBe('F-1')
      expect(result.returnPolicyId).toBe('R-1')
      expect(result.paymentPolicyId).toBe('P-1')
      expect(result.alreadyExisted).toEqual({
        fulfillment: false,
        return: false,
        payment: false,
      })
      expect(result.programOptIn).toEqual({ alreadyOptedIn: false })

      // Expected call pattern: 1 opt-in POST + 3 GETs + 3 POSTs = 7 calls
      expect(callLog.filter((c) => c.method === 'GET')).toHaveLength(3)
      expect(callLog.filter((c) => c.method === 'POST')).toHaveLength(4)

      // Settings patched with policy IDs
      const patches = (fakeAuth as any)._patches
      expect(patches).toHaveLength(1)
      expect(patches[0].policyIds).toEqual({
        fulfillmentPolicyId: 'F-1',
        returnPolicyId: 'R-1',
        paymentPolicyId: 'P-1',
      })
    })
  })
})

describe('EbaySandboxPoliciesService — MV-3 idempotent rerun', () => {
  it('discovers existing policies by name and does NOT POST again', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const fakeAuth = mkFakeAuth()
      const svc = new EbaySandboxPoliciesService(fakeAuth, mkFakeMerchantLocation())

      const { fetch, callLog } = mkRoutingFetch({
        // Pre-step: opt-in already done (HTTP 409 → silent skip).
        '/sell/account/v1/program/opt_in': () => ({
          status: 409,
          body: JSON.stringify({
            errors: [{ errorId: 25803, message: 'already exists' }],
          }),
        }),
        '/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_DE': () => ({
          status: 200,
          body: JSON.stringify({
            fulfillmentPolicies: [
              { fulfillmentPolicyId: 'F-EXIST', name: 'MALAK_STANDARD_DE' },
              { fulfillmentPolicyId: 'F-OTHER', name: 'SOMETHING_ELSE' },
            ],
          }),
        }),
        '/sell/account/v1/return_policy?marketplace_id=EBAY_DE': () => ({
          status: 200,
          body: JSON.stringify({
            returnPolicies: [{ returnPolicyId: 'R-EXIST', name: 'MALAK_14D_BUYER_PAYS' }],
          }),
        }),
        '/sell/account/v1/payment_policy?marketplace_id=EBAY_DE': () => ({
          status: 200,
          body: JSON.stringify({
            paymentPolicies: [{ paymentPolicyId: 'P-EXIST', name: 'MALAK_MANAGED_PAYMENTS' }],
          }),
        }),
      })
      svc.__setFetchForTests(fetch)

      const result = await svc.bootstrapPolicies()

      expect(result).toEqual({
        fulfillmentPolicyId: 'F-EXIST',
        returnPolicyId: 'R-EXIST',
        paymentPolicyId: 'P-EXIST',
        alreadyExisted: { fulfillment: true, return: true, payment: true },
        programOptIn: { alreadyOptedIn: true },
        merchantLocation: {
          locationKey: 'malak-lager-berlin',
          alreadyExisted: false,
          wasDisabled: false,
        },
      })
      // 1 opt-in POST + 3 GETs = 4 calls — NO policy POSTs
      expect(callLog).toHaveLength(4)
      expect(callLog.filter((c) => c.method === 'GET')).toHaveLength(3)
      expect(callLog.filter((c) => c.method === 'POST')).toHaveLength(1)
    })
  })

  it('mixed state: creates the ones missing, keeps the ones present', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const fakeAuth = mkFakeAuth()
      const svc = new EbaySandboxPoliciesService(fakeAuth, mkFakeMerchantLocation())

      const { fetch, callLog } = mkRoutingFetch({
        // Pre-step: opt-in already done.
        '/sell/account/v1/program/opt_in': () => ({ status: 409, body: '{}' }),
        '/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_DE': () => ({
          status: 200,
          body: JSON.stringify({
            fulfillmentPolicies: [{ fulfillmentPolicyId: 'F-EXIST', name: 'MALAK_STANDARD_DE' }],
          }),
        }),
        '/sell/account/v1/return_policy?marketplace_id=EBAY_DE': () => ({
          status: 200,
          body: JSON.stringify({ returnPolicies: [] }),
        }),
        '/sell/account/v1/return_policy': () => ({
          status: 201,
          body: JSON.stringify({ returnPolicyId: 'R-NEW' }),
        }),
        '/sell/account/v1/payment_policy?marketplace_id=EBAY_DE': () => ({
          status: 200,
          body: JSON.stringify({
            paymentPolicies: [{ paymentPolicyId: 'P-EXIST', name: 'MALAK_MANAGED_PAYMENTS' }],
          }),
        }),
      })
      svc.__setFetchForTests(fetch)

      const result = await svc.bootstrapPolicies()

      expect(result.fulfillmentPolicyId).toBe('F-EXIST')
      expect(result.returnPolicyId).toBe('R-NEW')
      expect(result.paymentPolicyId).toBe('P-EXIST')
      expect(result.alreadyExisted).toEqual({
        fulfillment: true,
        return: false,
        payment: true,
      })
      expect(result.programOptIn).toEqual({ alreadyOptedIn: true })
      // 1 opt-in POST + 3 GETs + 1 return-policy POST = 5 calls
      expect(callLog.filter((c) => c.method === 'GET')).toHaveLength(3)
      expect(callLog.filter((c) => c.method === 'POST')).toHaveLength(2)
    })
  })

  it('tolerates 404 on policy-list endpoint (no policies of this type yet)', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const fakeAuth = mkFakeAuth()
      const svc = new EbaySandboxPoliciesService(fakeAuth, mkFakeMerchantLocation())

      const { fetch, callLog } = mkRoutingFetch({
        // Pre-step: fresh opt-in.
        '/sell/account/v1/program/opt_in': () => ({ status: 200, body: '{}' }),
        '/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_DE': () => ({
          status: 404,
          body: JSON.stringify({ errors: [{ message: 'no policies' }] }),
        }),
        '/sell/account/v1/fulfillment_policy': () => ({
          status: 201,
          body: JSON.stringify({ fulfillmentPolicyId: 'F-1' }),
        }),
        '/sell/account/v1/return_policy?marketplace_id=EBAY_DE': () => ({
          status: 200,
          body: JSON.stringify({ returnPolicies: [] }),
        }),
        '/sell/account/v1/return_policy': () => ({
          status: 201,
          body: JSON.stringify({ returnPolicyId: 'R-1' }),
        }),
        '/sell/account/v1/payment_policy?marketplace_id=EBAY_DE': () => ({
          status: 200,
          body: JSON.stringify({ paymentPolicies: [] }),
        }),
        '/sell/account/v1/payment_policy': () => ({
          status: 201,
          body: JSON.stringify({ paymentPolicyId: 'P-1' }),
        }),
      })
      svc.__setFetchForTests(fetch)

      const result = await svc.bootstrapPolicies()
      expect(result.fulfillmentPolicyId).toBe('F-1')
      // 404 on list was retried by the client (retryable). Not an
      // assertion target — we just assert it didn't crash.
      expect(callLog.length).toBeGreaterThanOrEqual(7) // 1 opt-in + 3 GETs (incl retries on 404) + 3 POSTs
    })
  })
})

describe('EbaySandboxPoliciesService — MV: program opt-in pre-step', () => {
  it('MV-1: fresh 200 opt-in response → bootstrap continues normally, programOptIn.alreadyOptedIn=false', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const fakeAuth = mkFakeAuth()
      const svc = new EbaySandboxPoliciesService(fakeAuth, mkFakeMerchantLocation())
      const { fetch, callLog } = mkRoutingFetch({
        '/sell/account/v1/program/opt_in': () => ({ status: 200, body: '{}' }),
        '/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_DE': () => ({ status: 200, body: '{"fulfillmentPolicies":[]}' }),
        '/sell/account/v1/fulfillment_policy': () => ({ status: 201, body: '{"fulfillmentPolicyId":"F-MV1"}' }),
        '/sell/account/v1/return_policy?marketplace_id=EBAY_DE': () => ({ status: 200, body: '{"returnPolicies":[]}' }),
        '/sell/account/v1/return_policy': () => ({ status: 201, body: '{"returnPolicyId":"R-MV1"}' }),
        '/sell/account/v1/payment_policy?marketplace_id=EBAY_DE': () => ({ status: 200, body: '{"paymentPolicies":[]}' }),
        '/sell/account/v1/payment_policy': () => ({ status: 201, body: '{"paymentPolicyId":"P-MV1"}' }),
      })
      svc.__setFetchForTests(fetch)

      const result = await svc.bootstrapPolicies()

      expect(result.programOptIn).toEqual({ alreadyOptedIn: false })
      expect(result.fulfillmentPolicyId).toBe('F-MV1')

      // Opt-in was the FIRST call (before any policy list).
      expect(callLog[0].method).toBe('POST')
      expect(callLog[0].url).toContain('/sell/account/v1/program/opt_in')

      // And it sent the correct programType.
      expect(callLog[0].body).toBeDefined()
      const body = JSON.parse(callLog[0].body!)
      expect(body).toEqual({ programType: 'SELLING_POLICY_MANAGEMENT' })
    })
  })

  it('MV-2: 409 Conflict on opt-in → silent skip, programOptIn.alreadyOptedIn=true, bootstrap continues', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const fakeAuth = mkFakeAuth()
      const svc = new EbaySandboxPoliciesService(fakeAuth, mkFakeMerchantLocation())
      const { fetch } = mkRoutingFetch({
        '/sell/account/v1/program/opt_in': () => ({
          status: 409,
          body: JSON.stringify({
            errors: [{ errorId: 25803, message: 'programType already exists' }],
          }),
        }),
        '/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_DE': () => ({ status: 200, body: '{"fulfillmentPolicies":[]}' }),
        '/sell/account/v1/fulfillment_policy': () => ({ status: 201, body: '{"fulfillmentPolicyId":"F-MV2"}' }),
        '/sell/account/v1/return_policy?marketplace_id=EBAY_DE': () => ({ status: 200, body: '{"returnPolicies":[]}' }),
        '/sell/account/v1/return_policy': () => ({ status: 201, body: '{"returnPolicyId":"R-MV2"}' }),
        '/sell/account/v1/payment_policy?marketplace_id=EBAY_DE': () => ({ status: 200, body: '{"paymentPolicies":[]}' }),
        '/sell/account/v1/payment_policy': () => ({ status: 201, body: '{"paymentPolicyId":"P-MV2"}' }),
      })
      svc.__setFetchForTests(fetch)

      const result = await svc.bootstrapPolicies()
      expect(result.programOptIn).toEqual({ alreadyOptedIn: true })
      expect(result.fulfillmentPolicyId).toBe('F-MV2')
    })
  })

  it('MV-2b: non-409 response carrying errorId 25803 is also treated as already-opted-in', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const fakeAuth = mkFakeAuth()
      const svc = new EbaySandboxPoliciesService(fakeAuth, mkFakeMerchantLocation())
      const { fetch } = mkRoutingFetch({
        // Some sandbox variants return 400 (not 409) with errorId 25803.
        '/sell/account/v1/program/opt_in': () => ({
          status: 400,
          body: JSON.stringify({ errors: [{ errorId: 25803, message: 'already applied' }] }),
        }),
        '/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_DE': () => ({ status: 200, body: '{"fulfillmentPolicies":[]}' }),
        '/sell/account/v1/fulfillment_policy': () => ({ status: 201, body: '{"fulfillmentPolicyId":"F-MV2b"}' }),
        '/sell/account/v1/return_policy?marketplace_id=EBAY_DE': () => ({ status: 200, body: '{"returnPolicies":[]}' }),
        '/sell/account/v1/return_policy': () => ({ status: 201, body: '{"returnPolicyId":"R-MV2b"}' }),
        '/sell/account/v1/payment_policy?marketplace_id=EBAY_DE': () => ({ status: 200, body: '{"paymentPolicies":[]}' }),
        '/sell/account/v1/payment_policy': () => ({ status: 201, body: '{"paymentPolicyId":"P-MV2b"}' }),
      })
      svc.__setFetchForTests(fetch)

      const result = await svc.bootstrapPolicies()
      expect(result.programOptIn).toEqual({ alreadyOptedIn: true })
    })
  })

  it('MV-3: 500 Internal Server Error on opt-in → throws, policy endpoints never reached', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const fakeAuth = mkFakeAuth()
      const svc = new EbaySandboxPoliciesService(fakeAuth, mkFakeMerchantLocation())
      const { fetch, callLog } = mkRoutingFetch({
        // Opt-in crashes server-side. Not retryable after MAX_RETRIES.
        '/sell/account/v1/program/opt_in': () => ({
          status: 500,
          body: JSON.stringify({ errors: [{ errorId: 20500, message: 'system error' }] }),
        }),
        // Policy routes are defined but should NEVER be hit — opt-in throws first.
        '/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_DE': () => ({ status: 200, body: '{"fulfillmentPolicies":[]}' }),
      })
      svc.__setFetchForTests(fetch)

      await expect(svc.bootstrapPolicies()).rejects.toThrow()

      // Every call in the log must be to the opt-in endpoint. No
      // policy-list / policy-create call may have been attempted.
      for (const c of callLog) {
        expect(c.url).toContain('/sell/account/v1/program/opt_in')
      }
    })
  })

  it('MV-4: 400 Bad Request with UNKNOWN errorId on opt-in → throws (not silent-skip)', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const fakeAuth = mkFakeAuth()
      const svc = new EbaySandboxPoliciesService(fakeAuth, mkFakeMerchantLocation())
      const { fetch, callLog } = mkRoutingFetch({
        '/sell/account/v1/program/opt_in': () => ({
          status: 400,
          body: JSON.stringify({
            errors: [{ errorId: 20401, message: 'Missing required field' }],
          }),
        }),
        '/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_DE': () => ({ status: 200, body: '{"fulfillmentPolicies":[]}' }),
      })
      svc.__setFetchForTests(fetch)

      await expect(svc.bootstrapPolicies()).rejects.toThrow()

      // Again, policy endpoints must NOT have been hit.
      for (const c of callLog) {
        expect(c.url).toContain('/sell/account/v1/program/opt_in')
      }
    })
  })
})
