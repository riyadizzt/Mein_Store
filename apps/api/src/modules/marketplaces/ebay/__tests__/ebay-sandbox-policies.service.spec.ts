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
      const svc = new EbaySandboxPoliciesService(fakeAuth)
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
      const svc = new EbaySandboxPoliciesService(fakeAuth)

      const { fetch, callLog } = mkRoutingFetch({
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

      // Expected call pattern: 3 GETs + 3 POSTs = 6 calls
      expect(callLog.filter((c) => c.method === 'GET')).toHaveLength(3)
      expect(callLog.filter((c) => c.method === 'POST')).toHaveLength(3)

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
      const svc = new EbaySandboxPoliciesService(fakeAuth)

      const { fetch, callLog } = mkRoutingFetch({
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
      })
      // Exactly 3 GETs — no POSTs
      expect(callLog).toHaveLength(3)
      expect(callLog.every((c) => c.method === 'GET')).toBe(true)
    })
  })

  it('mixed state: creates the ones missing, keeps the ones present', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const fakeAuth = mkFakeAuth()
      const svc = new EbaySandboxPoliciesService(fakeAuth)

      const { fetch, callLog } = mkRoutingFetch({
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
      // 3 GETs + 1 POST for return only
      expect(callLog.filter((c) => c.method === 'GET')).toHaveLength(3)
      expect(callLog.filter((c) => c.method === 'POST')).toHaveLength(1)
    })
  })

  it('tolerates 404 on policy-list endpoint (no policies of this type yet)', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const fakeAuth = mkFakeAuth()
      const svc = new EbaySandboxPoliciesService(fakeAuth)

      const { fetch, callLog } = mkRoutingFetch({
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
      expect(callLog.length).toBeGreaterThanOrEqual(6)
    })
  })
})
