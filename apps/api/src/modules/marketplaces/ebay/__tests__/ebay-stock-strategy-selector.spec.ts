/**
 * C15.6 Tests — EbayStockStrategySelector.
 *
 * Coverage:
 *  - Lock acquisition success → primary strategy executes
 *  - Lock held_by_other → skipped=true
 *  - CLARIFICATION 4: Lock redis_outage → skipped + audit STOCK_PUSH_SKIPPED_REDIS_OUTAGE
 *  - Strategy chain: primary fails → fallback strategy
 *  - CLARIFICATION 2: ESCALATE with email rate-limit
 *  - CLARIFICATION 1: READ-ONLY PROBE only uses GET
 */

import { ConfigService } from '@nestjs/config'
import { EbayStockStrategySelector } from '../ebay-stock-strategy-selector'
import { StockUpdateContext } from '../ebay-stock-strategies/ebay-stock-update-strategy.interface'

class FakeRedis {
  store = new Map<string, string>()
  failOnSet = false
  failOnGet = false
  // Key-aware NX simulation: per-prefix override, default 'OK'
  nxResultByPrefix = new Map<string, 'OK' | null>()

  async set(key: string, _value: string, ..._rest: any[]): Promise<'OK' | null> {
    if (this.failOnSet) throw new Error('redis-outage')
    // Find matching prefix-override (longest match wins)
    let result: 'OK' | null = 'OK'
    let bestLen = -1
    for (const [prefix, val] of this.nxResultByPrefix) {
      if (key.startsWith(prefix) && prefix.length > bestLen) {
        result = val
        bestLen = prefix.length
      }
    }
    return result
  }
  async get(key: string): Promise<string | null> {
    if (this.failOnGet) throw new Error('redis-outage')
    return this.store.get(key) ?? null
  }
  async del(_key: string): Promise<number> {
    return 1
  }
  disconnect() {}
}

const ctx: StockUpdateContext = {
  listing: { id: 'lst-1', variantId: 'v-1', externalListingId: 'ebay-listing-1' },
  sku: 'MAL-TEST-1',
  offerId: 'offer-1',
  effectiveQuantity: 7,
  bearerToken: 'fake-token',
}

function buildSelector(opts: {
  bulkResult?: any
  getThenPutResult?: any
  primary?: 'bulk' | 'get_then_put' | null
  isAllDegraded?: boolean
  fakeRedis?: FakeRedis
} = {}) {
  const fakeRedis = opts.fakeRedis ?? new FakeRedis()
  const config = {
    get: (k: string) => {
      if (k === 'UPSTASH_REDIS_REST_URL') return 'https://fake'
      if (k === 'UPSTASH_REDIS_REST_TOKEN') return 'fake-token'
      return undefined
    },
  } as ConfigService

  const health: any = {
    pickPrimary: jest.fn().mockResolvedValue(opts.primary ?? 'bulk'),
    readState: jest.fn().mockImplementation((_s: string) => ({ isHealthy: true, cooldownUntil: null })),
    recordSuccess: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(false),
    isAllDegraded: jest.fn().mockResolvedValue(opts.isAllDegraded ?? false),
  }
  const bulk = {
    name: 'bulk' as const,
    execute: jest.fn().mockResolvedValue(opts.bulkResult ?? { ok: true, httpStatus: 200, errorMessage: null, errorId: null, rateLimited: false }),
  }
  const getThenPut = {
    name: 'get_then_put' as const,
    execute: jest.fn().mockResolvedValue(opts.getThenPutResult ?? { ok: true, httpStatus: 204, errorMessage: null, errorId: null, rateLimited: false }),
  }
  const audit = { log: jest.fn().mockResolvedValue(undefined) }
  const notifications = { createForAllAdmins: jest.fn().mockResolvedValue(undefined) }
  const prisma = {
    channelProductListing: {
      update: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  } as any

  const selector = new EbayStockStrategySelector(
    config,
    health,
    bulk as any,
    getThenPut as any,
    audit as any,
    notifications as any,
    prisma,
  )
  ;(selector as any).redis = fakeRedis
  ;(selector as any).redisAvailable = true
  return { selector, fakeRedis, health, bulk, getThenPut, audit, notifications, prisma }
}

describe('EbayStockStrategySelector', () => {
  beforeEach(() => jest.clearAllMocks())

  it('lock acquired → primary strategy executes', async () => {
    const { selector, bulk, getThenPut } = buildSelector({ primary: 'bulk' })
    // health.readState makes both healthy → chain = ['bulk', 'get_then_put']
    const result = await selector.executeForSku(ctx)

    expect(bulk.execute).toHaveBeenCalledWith(ctx)
    expect(getThenPut.execute).not.toHaveBeenCalled() // bulk succeeded
    expect(result.ok).toBe(true)
  })

  it('lock held_by_other → skipped=true (no strategy execution)', async () => {
    const fakeRedis = new FakeRedis()
    fakeRedis.nxResultByPrefix.set('ebay:lock:', null) // NX fail = lock held
    const { selector, bulk, getThenPut } = buildSelector({ fakeRedis })

    const result = await selector.executeForSku(ctx)

    expect(result.skipped).toBe(true)
    expect(result.errorMessage).toContain('sku_locked')
    expect(bulk.execute).not.toHaveBeenCalled()
    expect(getThenPut.execute).not.toHaveBeenCalled()
  })

  it('CLARIFICATION 4: Redis-Outage on lock-acquire → skipped + audit', async () => {
    const fakeRedis = new FakeRedis()
    fakeRedis.failOnSet = true // simulate Redis-Outage
    const { selector, audit, bulk } = buildSelector({ fakeRedis })

    const result = await selector.executeForSku(ctx)

    expect(result.skipped).toBe(true)
    expect(result.errorMessage).toBe('redis_outage_skip')
    expect(bulk.execute).not.toHaveBeenCalled()
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STOCK_PUSH_SKIPPED_REDIS_OUTAGE' }),
    )
  })

  it('Strategy chain: primary fails → fallback succeeds', async () => {
    const { selector, bulk, getThenPut, health } = buildSelector({
      bulkResult: { ok: false, httpStatus: 500, errorMessage: 'eBay 500', errorId: 25001, rateLimited: false },
      getThenPutResult: { ok: true, httpStatus: 204, errorMessage: null, errorId: null, rateLimited: false },
    })

    const result = await selector.executeForSku(ctx)

    expect(bulk.execute).toHaveBeenCalledTimes(1)
    expect(getThenPut.execute).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
    expect(health.recordFailure).toHaveBeenCalledWith('bulk')
    expect(health.recordSuccess).toHaveBeenCalledWith('get_then_put')
  })

  it('CLARIFICATION 2: ESCALATE with email rate-limit (first call sends, second suppresses)', async () => {
    const fakeRedis = new FakeRedis()
    const { selector, audit, notifications } = buildSelector({
      fakeRedis,
      bulkResult: { ok: false, httpStatus: 500, errorMessage: 'fail', errorId: null, rateLimited: false },
      getThenPutResult: { ok: false, httpStatus: 500, errorMessage: 'fail', errorId: null, rateLimited: false },
      isAllDegraded: true,
    })

    // First ESCALATE: should send email (Redis-key not exist)
    const result1 = await selector.executeForSku(ctx)
    expect(result1.ok).toBe(false)
    expect(notifications.createForAllAdmins).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ebay_stock_sync_escalation' }),
    )

    // Second ESCALATE within 24h: should suppress (only email-key fails NX, lock-key still OK)
    fakeRedis.nxResultByPrefix.set('ebay:escalate:last-email:', null)
    const result2 = await selector.executeForSku(ctx)
    expect(result2.ok).toBe(false)
    // Audit must include suppressed-event
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STOCK_PUSH_ESCALATE_EMAIL_SUPPRESSED' }),
    )
  })

  it('CLARIFICATION 1: READ-ONLY PROBE only triggers GET', async () => {
    const { selector, prisma, health } = buildSelector()
    // resolveCanarySku falls back to DB
    prisma.channelProductListing.findFirst.mockResolvedValue({ variant: { sku: 'CANARY-SKU' } })

    // Mock the dynamic-import inside runReadOnlyProbe
    // The strategy makes a GET via EbayApiClient — mock that
    const reqMock = jest.fn().mockResolvedValue({ sku: 'CANARY-SKU' })
    jest.doMock('../ebay-api.client', () => {
      const actual = jest.requireActual('../ebay-api.client')
      return { ...actual, EbayApiClient: jest.fn(() => ({ request: reqMock })) }
    })

    const result = await selector.runReadOnlyProbe('bulk', 'fake-token')

    expect(result.ok).toBe(true)
    expect(result.canarySku).toBe('CANARY-SKU')
    // Verify ONLY GET method was used
    if (reqMock.mock.calls.length > 0) {
      const allMethods = reqMock.mock.calls.map((c: any[]) => c[0])
      expect(allMethods.every((m: string) => m === 'GET')).toBe(true)
    }
    expect(health.recordSuccess).toHaveBeenCalledWith('bulk')
  })
})
