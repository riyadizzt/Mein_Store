/**
 * C15.3 — createFromMarketplace ORDER_EVENTS.CONFIRMED emission tests.
 *
 * Pins the C15.3 contract:
 *   1. After MARKETPLACE_ORDER_EVENTS.IMPORTED is emitted, the
 *      reservationIds returned by listener(s) are flattened and
 *      passed explicitly to ORDER_EVENTS.CONFIRMED.
 *   2. If no reservations were created (compensation rollback,
 *      empty draft) → CONFIRMED emit is SKIPPED (guard).
 *   3. The CONFIRMED event payload contains orderId + orderNumber +
 *      correlationId + reservationIds — matching OrderConfirmedEvent
 *      contract that the inventory.listener.handleOrderConfirmed
 *      method consumes.
 *   4. Owner-decision Q-5: explicit pass via emitAsync return value,
 *      NOT DB-re-query. The companion event-emitter-contract.spec
 *      pins the underlying NestJS-EventEmitter behaviour separately.
 *
 * Hard-Rule snapshot:
 *   - This spec only exercises createFromMarketplace. The legacy
 *     orders.service.spec.ts remains untouched.
 *   - Mock pattern mirrors orders-marketplace-create.spec.ts.
 */

import { OrdersService } from '../orders.service'
import type { MarketplaceOrderDraft, MarketplaceBuyer } from '../../marketplaces/core/types'
import { MARKETPLACE_ORDER_EVENTS } from '../events/marketplace-order-imported.event'
import { ORDER_EVENTS } from '../events/order.events'

function buildPrisma() {
  const prisma: any = {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'stub-user-1' }),
    },
    address: { create: jest.fn().mockResolvedValue({ id: 'addr-1' }) },
    inventory: {
      findMany: jest.fn().mockResolvedValue([
        { quantityOnHand: 100, quantityReserved: 0, warehouse: { id: 'wh-1', isDefault: true } },
      ]),
    },
    warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'wh-default' }) },
    order: {
      create: jest.fn().mockResolvedValue({
        id: 'order-1',
        orderNumber: 'ORD-20260501-000001',
        items: [],
      }),
    },
    payment: { create: jest.fn().mockResolvedValue({}) },
    orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn().mockImplementation((fn) => fn(prisma)),
    $queryRaw: jest.fn().mockResolvedValue([{ seq: 1 }]),
  }
  return prisma
}

/**
 * Build a controllable EventEmitter mock. emitAsyncResolve allows
 * each test to specify what value emitAsync should resolve to —
 * simulating different listener-return shapes.
 */
function buildEventEmitter(emitAsyncResolve: any[] = []) {
  const calls: Array<{ event: string; payload: any }> = []
  const emitAsync = jest.fn(async (event: string, payload: any) => {
    calls.push({ event, payload })
    // Only the IMPORTED event gets the configured return value;
    // CONFIRMED gets [] (no listeners simulated in this spec).
    if (event === MARKETPLACE_ORDER_EVENTS.IMPORTED) return emitAsyncResolve
    return []
  })
  return {
    emit: jest.fn(),
    emitAsync,
    calls,
  } as any
}

function buildService(prisma: any, eventEmitter: any) {
  return new OrdersService(
    prisma,
    eventEmitter,
    { hashBody: jest.fn(), get: jest.fn(), reserve: jest.fn(), save: jest.fn() } as any,
    { calculate: jest.fn() } as any,
    { validateCoupon: jest.fn() } as any,
  )
}

function buildDraft(): MarketplaceOrderDraft {
  return {
    lines: [
      {
        variantId: 'variant-1',
        externalSkuRef: 'MAL-HERREN-SCH-40',
        externalListingId: '284567890123',
        quantity: 1,
        unitPriceGross: '59.90',
        snapshotName: 'Herren Schuhe Schwarz 40',
      },
    ],
    shippingAddress: {
      firstName: 'Anna',
      lastName: 'Becker',
      street: 'Hauptstrasse',
      houseNumber: '42',
      postalCode: '10117',
      city: 'Berlin',
      country: 'DE',
    },
    subtotalGross: '59.90',
    shippingCostGross: '4.99',
    totalGross: '64.89',
    currency: 'EUR',
  }
}

function buildBuyer(): MarketplaceBuyer {
  return {
    externalBuyerRef: 'ebay-buyer-X',
    email: 'ebay-token-X@marketplace.local',
    isSynthetic: true,
    firstName: 'Anna',
    lastName: 'Becker',
    locale: 'de',
  }
}

describe('OrdersService.createFromMarketplace — C15.3 CONFIRMED emission', () => {
  it('emits ORDER_EVENTS.CONFIRMED with reservationIds after IMPORTED-listener returns IDs', async () => {
    const prisma = buildPrisma()
    // Simulate inventory.listener.handleOrderCreated returning 2 reservation IDs
    const ee = buildEventEmitter([['res-A', 'res-B']])
    const svc = buildService(prisma, ee)

    await svc.createFromMarketplace(buildDraft(), buildBuyer(), 'EBAY', 'EX-1', 'corr-1')

    // Both events emitted, in correct order
    expect(ee.calls).toHaveLength(2)
    expect(ee.calls[0].event).toBe(MARKETPLACE_ORDER_EVENTS.IMPORTED)
    expect(ee.calls[1].event).toBe(ORDER_EVENTS.CONFIRMED)

    // CONFIRMED payload shape matches OrderConfirmedEvent contract
    const confirmedEvt = ee.calls[1].payload
    expect(confirmedEvt.orderId).toBe('order-1')
    expect(confirmedEvt.orderNumber).toBe('ORD-20260501-000001')
    expect(confirmedEvt.correlationId).toBe('corr-1')
    expect(confirmedEvt.reservationIds).toEqual(['res-A', 'res-B'])
  })

  it('flattens nested return-values from MULTIPLE listeners into one reservationIds array', async () => {
    const prisma = buildPrisma()
    // Simulate 2 separate listeners both returning string[]
    const ee = buildEventEmitter([['res-A', 'res-B'], ['res-C']])
    const svc = buildService(prisma, ee)

    await svc.createFromMarketplace(buildDraft(), buildBuyer(), 'EBAY', 'EX-2', 'corr-2')

    const confirmedEvt = ee.calls.find((c: any) => c.event === ORDER_EVENTS.CONFIRMED)?.payload
    expect(confirmedEvt.reservationIds).toEqual(['res-A', 'res-B', 'res-C'])
  })

  it('SKIPS CONFIRMED emit when no reservations were created (compensation/rollback path)', async () => {
    const prisma = buildPrisma()
    // emitAsync returns empty array — no listener returned IDs
    const ee = buildEventEmitter([])
    const svc = buildService(prisma, ee)

    await svc.createFromMarketplace(buildDraft(), buildBuyer(), 'EBAY', 'EX-3', 'corr-3')

    const confirmedEmits = ee.calls.filter((c: any) => c.event === ORDER_EVENTS.CONFIRMED)
    expect(confirmedEmits).toHaveLength(0)
    // IMPORTED emit still happened — CONFIRMED skipping is the only diff
    expect(ee.calls.filter((c: any) => c.event === MARKETPLACE_ORDER_EVENTS.IMPORTED)).toHaveLength(1)
  })

  it('SKIPS CONFIRMED emit when listener returned a non-array (defensive filter)', async () => {
    const prisma = buildPrisma()
    // Simulate buggy listener returning undefined/null instead of string[]
    const ee = buildEventEmitter([undefined as any, null as any])
    const svc = buildService(prisma, ee)

    await svc.createFromMarketplace(buildDraft(), buildBuyer(), 'EBAY', 'EX-4', 'corr-4')

    const confirmedEmits = ee.calls.filter((c: any) => c.event === ORDER_EVENTS.CONFIRMED)
    expect(confirmedEmits).toHaveLength(0)
  })

  it('FILTERS empty-string + non-string entries from reservationIds', async () => {
    const prisma = buildPrisma()
    // Simulate noisy listener output
    const ee = buildEventEmitter([['res-A', '', null as any, 42 as any, 'res-B']])
    const svc = buildService(prisma, ee)

    await svc.createFromMarketplace(buildDraft(), buildBuyer(), 'EBAY', 'EX-5', 'corr-5')

    const confirmedEvt = ee.calls.find((c: any) => c.event === ORDER_EVENTS.CONFIRMED)?.payload
    // Only valid string IDs survive
    expect(confirmedEvt.reservationIds).toEqual(['res-A', 'res-B'])
  })

  it('CONFIRMED emit happens AFTER IMPORTED emit (sequence verified)', async () => {
    const prisma = buildPrisma()
    const ee = buildEventEmitter([['res-A']])
    const svc = buildService(prisma, ee)

    await svc.createFromMarketplace(buildDraft(), buildBuyer(), 'EBAY', 'EX-6', 'corr-6')

    // The order in ee.calls reflects emit-call-order. IMPORTED must
    // be index 0, CONFIRMED must be index 1.
    expect(ee.calls[0].event).toBe(MARKETPLACE_ORDER_EVENTS.IMPORTED)
    expect(ee.calls[1].event).toBe(ORDER_EVENTS.CONFIRMED)
  })
})
