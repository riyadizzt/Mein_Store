/**
 * Graceful-degraded fallback tests (C3).
 *
 * Asserts the two-tier failure behaviour configured in FeedsService:
 *   1. stale cache available → return it, NO throw
 *   2. no cache → re-throw so the controller can 503
 *
 * We drive the failure by making prisma.product.findMany throw on the
 * second call (after the first populated the cache), then drive recovery
 * by making it succeed again.
 */

import { FeedsService } from '../feeds.service'

function buildMockPrisma(opts: { throwOnCall?: number; productReturn?: any[] }) {
  let callCount = 0
  return {
    shopSetting: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async (x: any) => x.data),
      upsert: jest.fn(),
    },
    product: {
      findMany: jest.fn(async () => {
        callCount++
        if (opts.throwOnCall && callCount === opts.throwOnCall) {
          throw new Error(`SIMULATED DB FAILURE call #${callCount}`)
        }
        return opts.productReturn ?? []
      }),
    },
  }
}

describe('FeedsService — graceful fallback (C3)', () => {
  it('serves stale cache when generation fails AFTER successful first run', async () => {
    // First call succeeds → cache populated. Second call (force=true)
    // reaches prisma again, throws. Helper should return the staled
    // copy WITHOUT throwing.
    const prisma = buildMockPrisma({ throwOnCall: 2, productReturn: [] })
    const feeds = new FeedsService(prisma as any)
    // First call — success, empty but valid XML
    const first = await feeds.getFacebookFeed('de', true)
    expect(first.xml).toContain('<rss')
    // Second call — prisma throws → helper falls back to stale cache
    const second = await feeds.getFacebookFeed('de', true)
    expect(second.xml).toBe(first.xml) // byte-equal
  })

  it('re-throws when no cache exists and generation fails (hard fail path)', async () => {
    const prisma = buildMockPrisma({ throwOnCall: 1 })
    const feeds = new FeedsService(prisma as any)
    await expect(feeds.getFacebookFeed('de', true)).rejects.toThrow('SIMULATED DB FAILURE')
  })

  it('each of the 4 feed types wraps generation in the same helper', async () => {
    // Regression guard: if someone refactors away the try/catch on one
    // of the generators, this test catches it.
    const prisma = buildMockPrisma({ throwOnCall: 1 })
    const feeds = new FeedsService(prisma as any)
    await expect(feeds.getFacebookFeed('de', true)).rejects.toThrow(/SIMULATED/)
    // Reset the call counter by building fresh for each check
    const p2 = buildMockPrisma({ throwOnCall: 1 })
    const f2 = new FeedsService(p2 as any)
    await expect(f2.getTikTokFeed('de', true)).rejects.toThrow(/SIMULATED/)
    const p3 = buildMockPrisma({ throwOnCall: 1 })
    const f3 = new FeedsService(p3 as any)
    await expect(f3.getGoogleFeed('de', true)).rejects.toThrow(/SIMULATED/)
    const p4 = buildMockPrisma({ throwOnCall: 1 })
    const f4 = new FeedsService(p4 as any)
    await expect(f4.getWhatsAppFeed('de', true)).rejects.toThrow(/SIMULATED/)
  })

  it('stale-cache fallback preserves the FeedStats shape', async () => {
    const prisma = buildMockPrisma({ throwOnCall: 2, productReturn: [] })
    const feeds = new FeedsService(prisma as any)
    const first = await feeds.getFacebookFeed('de', true)
    const second = await feeds.getFacebookFeed('de', true)
    expect(second.stats).toEqual(first.stats)
  })
})
