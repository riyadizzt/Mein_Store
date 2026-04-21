/**
 * channel-safety-stock helper unit tests (C5).
 *
 * Covers:
 *   - computeAvailableStock: max-per-warehouse semantics, edge cases
 *   - decideSafetyTransition: all 6 state/availability combos
 *       (pause conditions, resume conditions, no-op cases, manual-
 *        pause-never-resumed invariant)
 *   - propagateChannelSafety integration:
 *       pause path with notification + audit
 *       resume path with audit (no notification)
 *       manual-pause is NEVER auto-resumed
 *       missing inventory rows treated as available=0
 *       variantId=null rows are skipped safely
 *       exceptions inside the sweep don't propagate
 *   - singleton ref register/unregister
 */

import {
  computeAvailableStock,
  decideSafetyTransition,
  propagateChannelSafety,
  registerChannelSafetyAuditor,
  registerChannelSafetyNotifier,
  propagateChannelSafetyCheck,
  type SafetyPrismaClient,
} from '../channel-safety-stock'

describe('computeAvailableStock', () => {
  it('returns 0 for empty list', () => {
    expect(computeAvailableStock([])).toBe(0)
  })

  it('returns 0 when rows are all out-of-stock', () => {
    expect(computeAvailableStock([
      { quantityOnHand: 5, quantityReserved: 5 },
      { quantityOnHand: 3, quantityReserved: 3 },
    ])).toBe(0)
  })

  it('returns MAX across warehouses — not sum', () => {
    // Warehouse A: 5-2=3, B: 10-0=10, C: 100-99=1 → max is 10
    expect(computeAvailableStock([
      { quantityOnHand: 5, quantityReserved: 2 },
      { quantityOnHand: 10, quantityReserved: 0 },
      { quantityOnHand: 100, quantityReserved: 99 },
    ])).toBe(10)
  })

  it('clamps negative at 0 (over-reservation defensive)', () => {
    // Defensive: reserved > onHand should never happen but we clamp
    expect(computeAvailableStock([
      { quantityOnHand: 2, quantityReserved: 5 },
    ])).toBe(0)
  })
})

describe('decideSafetyTransition', () => {
  const listingActive = { status: 'active', pauseReason: null, safetyStock: 2 }
  const listingPending = { status: 'pending', pauseReason: null, safetyStock: 2 }
  const listingPausedLowStock = { status: 'paused', pauseReason: 'low_stock', safetyStock: 2 }
  const listingPausedManual = { status: 'paused', pauseReason: 'manual', safetyStock: 2 }

  it('pauses active listing when stock <= threshold', () => {
    expect(decideSafetyTransition(listingActive, 2)).toEqual({ nextStatus: 'paused', reason: 'low_stock' })
    expect(decideSafetyTransition(listingActive, 1)).toEqual({ nextStatus: 'paused', reason: 'low_stock' })
    expect(decideSafetyTransition(listingActive, 0)).toEqual({ nextStatus: 'paused', reason: 'low_stock' })
  })

  it('pauses pending listing too (not just active)', () => {
    expect(decideSafetyTransition(listingPending, 2)).toEqual({ nextStatus: 'paused', reason: 'low_stock' })
  })

  it('no-op when active listing has enough stock', () => {
    expect(decideSafetyTransition(listingActive, 3)).toBeNull()
    expect(decideSafetyTransition(listingActive, 100)).toBeNull()
  })

  it('resumes low-stock-paused listing when stock > threshold', () => {
    expect(decideSafetyTransition(listingPausedLowStock, 3)).toEqual({ nextStatus: 'active', reason: null })
  })

  it('NEVER auto-resumes manual-paused listings (critical invariant)', () => {
    expect(decideSafetyTransition(listingPausedManual, 3)).toBeNull()
    expect(decideSafetyTransition(listingPausedManual, 1000)).toBeNull()
  })

  it('no-op when paused with any other reason (sync_error etc.)', () => {
    expect(decideSafetyTransition(
      { status: 'paused', pauseReason: 'sync_error', safetyStock: 2 },
      100,
    )).toBeNull()
  })

  it('keeps low-stock-paused listing paused when stock still too low', () => {
    expect(decideSafetyTransition(listingPausedLowStock, 2)).toBeNull()
    expect(decideSafetyTransition(listingPausedLowStock, 0)).toBeNull()
  })
})

// ── Integration tests with mock Prisma ─────────────────────────────

function buildMockPrisma(opts: {
  listings?: any[]
  inventory?: any[]
  productTranslations?: any[]
}): SafetyPrismaClient {
  return {
    inventory: {
      findMany: jest.fn(async () => opts.inventory ?? []),
    },
    channelProductListing: {
      findMany: jest.fn(async () => opts.listings ?? []),
      update: jest.fn(async () => ({})),
    },
    product: {
      findUnique: jest.fn(async () => ({
        id: 'p1',
        translations: opts.productTranslations ?? [{ language: 'de', name: 'Testprodukt' }],
      })),
    },
  } as any
}

describe('propagateChannelSafety — integration', () => {
  it('pauses active listing + writes notification + audit on low stock', async () => {
    const prisma = buildMockPrisma({
      listings: [{
        id: 'l1', variantId: 'v1', channel: 'facebook', productId: 'p1',
        status: 'active', pauseReason: null, safetyStock: 2,
      }],
      inventory: [{ variantId: 'v1', quantityOnHand: 2, quantityReserved: 0 }],
    })
    const notifier = { createForAllAdmins: jest.fn().mockResolvedValue({}) }
    const auditor = { log: jest.fn().mockResolvedValue({}) }

    const result = await propagateChannelSafety(prisma, ['v1'], notifier, auditor)

    expect(result).toEqual({ paused: 1, resumed: 0, skipped: 0 })
    const updateArgs = (prisma.channelProductListing.update as jest.Mock).mock.calls[0][0]
    expect(updateArgs.where).toEqual({ id: 'l1' })
    expect(updateArgs.data.status).toBe('paused')
    expect(updateArgs.data.pauseReason).toBe('low_stock')
    expect(updateArgs.data.pausedAt).toBeInstanceOf(Date)

    expect(notifier.createForAllAdmins).toHaveBeenCalledTimes(1)
    const notifArg = notifier.createForAllAdmins.mock.calls[0][0]
    expect(notifArg.type).toBe('channel_auto_paused')
    expect(notifArg.title).toMatch(/pausiert/i)
    expect(notifArg.entityId).toBe('p1')
    expect(notifArg.data.channel).toBe('facebook')

    expect(auditor.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CHANNEL_LISTING_AUTO_PAUSED',
      entityType: 'product',
      entityId: 'p1',
    }))
  })

  it('resumes low-stock-paused listing when stock recovers + audits (NO notification)', async () => {
    const prisma = buildMockPrisma({
      listings: [{
        id: 'l1', variantId: 'v1', channel: 'google', productId: 'p1',
        status: 'paused', pauseReason: 'low_stock', safetyStock: 2,
      }],
      inventory: [{ variantId: 'v1', quantityOnHand: 20, quantityReserved: 0 }],
    })
    const notifier = { createForAllAdmins: jest.fn().mockResolvedValue({}) }
    const auditor = { log: jest.fn().mockResolvedValue({}) }

    const result = await propagateChannelSafety(prisma, ['v1'], notifier, auditor)

    expect(result).toEqual({ paused: 0, resumed: 1, skipped: 0 })
    const updateArgs = (prisma.channelProductListing.update as jest.Mock).mock.calls[0][0]
    expect(updateArgs.data.status).toBe('active')
    expect(updateArgs.data.pauseReason).toBeNull()
    expect(updateArgs.data.pausedAt).toBeNull()

    // Resume is routine (no human attention needed) — no notification
    expect(notifier.createForAllAdmins).not.toHaveBeenCalled()
    expect(auditor.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CHANNEL_LISTING_AUTO_RESUMED',
    }))
  })

  it('NEVER auto-resumes manual-paused listings even when stock is high', async () => {
    const prisma = buildMockPrisma({
      listings: [{
        id: 'l1', variantId: 'v1', channel: 'facebook', productId: 'p1',
        status: 'paused', pauseReason: 'manual', safetyStock: 2,
      }],
      inventory: [{ variantId: 'v1', quantityOnHand: 1000, quantityReserved: 0 }],
    })
    // findMany filter excludes 'paused with pauseReason != low_stock',
    // so in practice this row never even reaches the helper. But the
    // decision function is the safety net — test it via the pure
    // function above; here we just verify the findMany filter doesn't
    // pick manual-paused up.
    await propagateChannelSafety(prisma, ['v1'])
    // Because our mock returns the listing unconditionally (ignores WHERE),
    // we can still verify the decision path: decideSafetyTransition
    // returns null for manual-paused at any stock → update NOT called.
    expect((prisma.channelProductListing.update as jest.Mock)).not.toHaveBeenCalled()
  })

  it('missing inventory rows → available=0 → pauses active listing', async () => {
    const prisma = buildMockPrisma({
      listings: [{
        id: 'l1', variantId: 'v1', channel: 'facebook', productId: 'p1',
        status: 'active', pauseReason: null, safetyStock: 0,
      }],
      inventory: [],
    })
    const result = await propagateChannelSafety(prisma, ['v1'])
    // safetyStock=0, available=0 → 0 <= 0 → pause
    expect(result.paused).toBe(1)
  })

  it('skips rows where variantId is null (legacy data)', async () => {
    const prisma = buildMockPrisma({
      listings: [{
        id: 'l1', variantId: null, channel: 'facebook', productId: 'p1',
        status: 'active', pauseReason: null, safetyStock: 2,
      }],
      inventory: [],
    })
    const result = await propagateChannelSafety(prisma, ['v1'])
    expect(result.skipped).toBe(1)
    expect((prisma.channelProductListing.update as jest.Mock)).not.toHaveBeenCalled()
  })

  it('no-op when variantIds array is empty', async () => {
    const prisma = buildMockPrisma({})
    const result = await propagateChannelSafety(prisma, [])
    expect(result).toEqual({ paused: 0, resumed: 0, skipped: 0 })
    expect(prisma.channelProductListing.findMany).not.toHaveBeenCalled()
  })

  it('swallows exceptions — never propagates to caller transaction', async () => {
    const prisma: any = {
      inventory: { findMany: jest.fn().mockRejectedValue(new Error('DB down')) },
      channelProductListing: { findMany: jest.fn().mockResolvedValue([{
        id: 'l1', variantId: 'v1', channel: 'facebook', productId: 'p1',
        status: 'active', pauseReason: null, safetyStock: 2,
      }]), update: jest.fn() },
      product: { findUnique: jest.fn() },
    }
    // Must NOT throw
    const result = await propagateChannelSafety(prisma, ['v1'])
    // Partial no-op: failure before any update triggered → zeros
    expect(result).toEqual({ paused: 0, resumed: 0, skipped: 0 })
  })
})

describe('singleton refs', () => {
  afterEach(() => {
    registerChannelSafetyNotifier(null)
    registerChannelSafetyAuditor(null)
  })

  it('propagateChannelSafetyCheck routes to registered notifier + auditor', async () => {
    const prisma = buildMockPrisma({
      listings: [{
        id: 'l1', variantId: 'v1', channel: 'facebook', productId: 'p1',
        status: 'active', pauseReason: null, safetyStock: 2,
      }],
      inventory: [{ variantId: 'v1', quantityOnHand: 1, quantityReserved: 0 }],
    })
    const notif = { createForAllAdmins: jest.fn().mockResolvedValue({}) }
    const audit = { log: jest.fn().mockResolvedValue({}) }
    registerChannelSafetyNotifier(notif)
    registerChannelSafetyAuditor(audit)

    const result = await propagateChannelSafetyCheck(prisma, ['v1'])
    expect(result.paused).toBe(1)
    expect(notif.createForAllAdmins).toHaveBeenCalled()
    expect(audit.log).toHaveBeenCalled()
  })

  it('works without any refs registered (pre-bootstrap / test isolation)', async () => {
    const prisma = buildMockPrisma({
      listings: [{
        id: 'l1', variantId: 'v1', channel: 'facebook', productId: 'p1',
        status: 'active', pauseReason: null, safetyStock: 2,
      }],
      inventory: [{ variantId: 'v1', quantityOnHand: 1, quantityReserved: 0 }],
    })
    // No notifier/auditor registered
    const result = await propagateChannelSafetyCheck(prisma, ['v1'])
    expect(result.paused).toBe(1)
    // DB update still happened
    expect((prisma.channelProductListing.update as jest.Mock)).toHaveBeenCalled()
  })
})
