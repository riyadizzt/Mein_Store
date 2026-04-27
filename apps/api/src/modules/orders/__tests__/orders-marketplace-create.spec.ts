/**
 * Tests for OrdersService.createFromMarketplace (C12.3).
 *
 * Marketplace-only path — separate spec file from orders.service.spec.ts
 * to keep the existing test suite untouched (Hard-Rule #2).
 *
 * Mock pattern mirrors orders.service.spec.ts.
 */

import { OrdersService } from '../orders.service'
import { DuplicateOrderException } from '../exceptions/duplicate-order.exception'
import type { MarketplaceOrderDraft, MarketplaceBuyer } from '../../marketplaces/core/types'
import { MARKETPLACE_ORDER_EVENTS } from '../events/marketplace-order-imported.event'

type AnyJest = jest.Mock<any, any>

// ── Mock Builder ─────────────────────────────────────────────

function buildPrisma() {
  const prisma: any = {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'stub-user-1' }),
    },
    address: {
      create: jest.fn().mockResolvedValue({ id: 'addr-1' }),
    },
    inventory: {
      findMany: jest.fn().mockResolvedValue([
        {
          quantityOnHand: 100,
          quantityReserved: 0,
          warehouse: { id: 'wh-1', isDefault: true },
        },
      ]),
    },
    warehouse: {
      findFirst: jest.fn().mockResolvedValue({ id: 'wh-default' }),
    },
    order: {
      create: jest.fn().mockResolvedValue({
        id: 'order-1',
        orderNumber: 'ORD-20260427-000001',
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

function buildEventEmitter() {
  return {
    emit: jest.fn(),
    emitAsync: jest.fn().mockResolvedValue([]),
  } as any
}

function buildService(prisma: any, eventEmitter?: any) {
  // Constructor positional args: prisma, eventEmitter, idempotency, shipping, marketing
  // (verified against orders.service.ts:60-71)
  return new OrdersService(
    prisma,
    eventEmitter ?? buildEventEmitter(),
    { hashBody: jest.fn(), get: jest.fn(), reserve: jest.fn(), save: jest.fn() } as any,
    { calculate: jest.fn() } as any,
    { validateCoupon: jest.fn() } as any,
  )
}

function buildDraft(overrides: Partial<MarketplaceOrderDraft> = {}): MarketplaceOrderDraft {
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
    ...overrides,
  }
}

function buildBuyer(overrides: Partial<MarketplaceBuyer> = {}): MarketplaceBuyer {
  return {
    email: 'ebay-anna_b_de2024@marketplace.local',
    isSynthetic: true,
    externalBuyerRef: 'anna_b_de2024',
    firstName: 'Anna',
    lastName: 'Becker',
    locale: 'de',
    ...overrides,
  }
}

// ── Stub-User Resolution ─────────────────────────────────────

describe('OrdersService.createFromMarketplace — stub-user resolution', () => {
  it('creates new stub-user for unknown synthetic email', async () => {
    const prisma = buildPrisma()
    const svc = buildService(prisma)
    await svc.createFromMarketplace(buildDraft(), buildBuyer(), 'EBAY', 'EX-1', 'corr-1')
    expect(prisma.user.create).toHaveBeenCalledTimes(1)
    const createCall = (prisma.user.create as AnyJest).mock.calls[0][0]
    expect(createCall.data.email).toBe('ebay-anna_b_de2024@marketplace.local')
    expect(createCall.data.isVerified).toBe(false)
    expect(createCall.data.role).toBe('customer')
  })

  it('reuses existing stub-user for repeat-buyer', async () => {
    const prisma = buildPrisma()
    ;(prisma.user.findUnique as AnyJest).mockResolvedValue({ id: 'existing-stub-id' })
    const svc = buildService(prisma)
    await svc.createFromMarketplace(buildDraft(), buildBuyer(), 'EBAY', 'EX-2', 'corr-2')
    expect(prisma.user.create).not.toHaveBeenCalled()
    const orderCall = (prisma.order.create as AnyJest).mock.calls[0][0]
    expect(orderCall.data.userId).toBe('existing-stub-id')
  })

  it('lowercases the synthetic email on lookup', async () => {
    const prisma = buildPrisma()
    const svc = buildService(prisma)
    await svc.createFromMarketplace(
      buildDraft(),
      buildBuyer({ email: 'EBAY-Anna_B_DE2024@MARKETPLACE.LOCAL' }),
      'EBAY',
      'EX-3',
      'corr-3',
    )
    const lookupCall = (prisma.user.findUnique as AnyJest).mock.calls[0][0]
    expect(lookupCall.where.email).toBe('ebay-anna_b_de2024@marketplace.local')
  })
})

// ── Address Handling ─────────────────────────────────────────

describe('OrdersService.createFromMarketplace — address handling', () => {
  it('creates fresh address row under stub-user', async () => {
    const prisma = buildPrisma()
    const svc = buildService(prisma)
    await svc.createFromMarketplace(buildDraft(), buildBuyer(), 'EBAY', 'EX-4', 'corr-4')
    expect(prisma.address.create).toHaveBeenCalledTimes(1)
    const addrCall = (prisma.address.create as AnyJest).mock.calls[0][0]
    expect(addrCall.data.userId).toBe('stub-user-1')
  })

  it('all address fields propagated', async () => {
    const prisma = buildPrisma()
    const svc = buildService(prisma)
    await svc.createFromMarketplace(buildDraft(), buildBuyer(), 'EBAY', 'EX-5', 'corr-5')
    const addrCall = (prisma.address.create as AnyJest).mock.calls[0][0]
    expect(addrCall.data).toMatchObject({
      firstName: 'Anna',
      lastName: 'Becker',
      street: 'Hauptstrasse',
      houseNumber: '42',
      postalCode: '10117',
      city: 'Berlin',
      country: 'DE',
    })
  })
})

// ── Soft Stock Check ─────────────────────────────────────────

describe('OrdersService.createFromMarketplace — soft stock check', () => {
  it('sufficient stock → no drift event', async () => {
    const prisma = buildPrisma()
    const ee = buildEventEmitter()
    const svc = buildService(prisma, ee)
    await svc.createFromMarketplace(buildDraft(), buildBuyer(), 'EBAY', 'EX-6', 'corr-6')
    const driftCalls = (ee.emit as AnyJest).mock.calls.filter(
      (c: any[]) => c[0] === 'marketplace.oversell.drift',
    )
    expect(driftCalls).toHaveLength(0)
  })

  it('partial drift → drift event with line', async () => {
    const prisma = buildPrisma()
    ;(prisma.inventory.findMany as AnyJest).mockResolvedValue([
      { quantityOnHand: 0, quantityReserved: 0, warehouse: { id: 'wh-1', isDefault: true } },
    ])
    const ee = buildEventEmitter()
    const svc = buildService(prisma, ee)
    const draft = buildDraft({ lines: [{ ...buildDraft().lines[0], quantity: 5 }] })
    await svc.createFromMarketplace(draft, buildBuyer(), 'EBAY', 'EX-7', 'corr-7')
    const driftCalls = (ee.emit as AnyJest).mock.calls.filter(
      (c: any[]) => c[0] === 'marketplace.oversell.drift',
    )
    expect(driftCalls).toHaveLength(1)
    expect(driftCalls[0][1].lines).toHaveLength(1)
    expect(driftCalls[0][1].lines[0].requested).toBe(5)
    expect(driftCalls[0][1].lines[0].available).toBe(0)
  })

  it('zero stock → drift event with 0 available', async () => {
    const prisma = buildPrisma()
    ;(prisma.inventory.findMany as AnyJest).mockResolvedValue([])
    const ee = buildEventEmitter()
    const svc = buildService(prisma, ee)
    await svc.createFromMarketplace(buildDraft(), buildBuyer(), 'EBAY', 'EX-8', 'corr-8')
    const driftCalls = (ee.emit as AnyJest).mock.calls.filter(
      (c: any[]) => c[0] === 'marketplace.oversell.drift',
    )
    expect(driftCalls).toHaveLength(1)
    expect(driftCalls[0][1].lines[0].available).toBe(0)
  })
})

// ── Order Creation ───────────────────────────────────────────

describe('OrdersService.createFromMarketplace — order creation', () => {
  it('channel="ebay" + channelOrderId + status="confirmed"', async () => {
    const prisma = buildPrisma()
    const svc = buildService(prisma)
    await svc.createFromMarketplace(buildDraft(), buildBuyer(), 'EBAY', 'EX-9', 'corr-9')
    const orderCall = (prisma.order.create as AnyJest).mock.calls[0][0]
    expect(orderCall.data.channel).toBe('ebay')
    expect(orderCall.data.channelOrderId).toBe('EX-9')
    expect(orderCall.data.status).toBe('confirmed')
  })

  it('notes JSON contains marketplace+externalOrderId+locale+buyerExternalRef', async () => {
    const prisma = buildPrisma()
    const svc = buildService(prisma)
    await svc.createFromMarketplace(buildDraft(), buildBuyer(), 'EBAY', 'EX-10', 'corr-10')
    const orderCall = (prisma.order.create as AnyJest).mock.calls[0][0]
    const notes = JSON.parse(orderCall.data.notes)
    expect(notes).toMatchObject({
      marketplace: 'EBAY',
      externalOrderId: 'EX-10',
      locale: 'de',
      buyerExternalRef: 'anna_b_de2024',
    })
  })

  it('totals: subtotal + shipping + total propagated as strings', async () => {
    const prisma = buildPrisma()
    const svc = buildService(prisma)
    await svc.createFromMarketplace(buildDraft(), buildBuyer(), 'EBAY', 'EX-11', 'corr-11')
    const orderCall = (prisma.order.create as AnyJest).mock.calls[0][0]
    expect(orderCall.data.subtotal).toBe('59.90')
    expect(orderCall.data.shippingCost).toBe('4.99')
    expect(orderCall.data.totalAmount).toBe('64.89')
  })

  it('items propagated with snapshotName + snapshotSku', async () => {
    const prisma = buildPrisma()
    const svc = buildService(prisma)
    await svc.createFromMarketplace(buildDraft(), buildBuyer(), 'EBAY', 'EX-12', 'corr-12')
    const orderCall = (prisma.order.create as AnyJest).mock.calls[0][0]
    expect(orderCall.data.items.create[0]).toMatchObject({
      variantId: 'variant-1',
      quantity: 1,
      snapshotName: 'Herren Schuhe Schwarz 40',
      snapshotSku: 'MAL-HERREN-SCH-40',
    })
  })
})

// ── Payment Creation ─────────────────────────────────────────

describe('OrdersService.createFromMarketplace — payment creation', () => {
  it('provider=EBAY_MANAGED_PAYMENTS + status=captured', async () => {
    const prisma = buildPrisma()
    const svc = buildService(prisma)
    await svc.createFromMarketplace(buildDraft(), buildBuyer(), 'EBAY', 'EX-13', 'corr-13')
    expect(prisma.payment.create).toHaveBeenCalledTimes(1)
    const payCall = (prisma.payment.create as AnyJest).mock.calls[0][0]
    expect(payCall.data.provider).toBe('EBAY_MANAGED_PAYMENTS')
    expect(payCall.data.status).toBe('captured')
    expect(payCall.data.method).toBe('ebay_managed_payments')
  })

  it('amount matches totalGross + currency=EUR', async () => {
    const prisma = buildPrisma()
    const svc = buildService(prisma)
    await svc.createFromMarketplace(buildDraft(), buildBuyer(), 'EBAY', 'EX-14', 'corr-14')
    const payCall = (prisma.payment.create as AnyJest).mock.calls[0][0]
    expect(payCall.data.amount).toBe('64.89')
    expect(payCall.data.currency).toBe('EUR')
    expect(payCall.data.providerPaymentId).toBe('EX-14')
  })

  it('paidAt is current Date', async () => {
    const prisma = buildPrisma()
    const svc = buildService(prisma)
    const before = Date.now()
    await svc.createFromMarketplace(buildDraft(), buildBuyer(), 'EBAY', 'EX-15', 'corr-15')
    const after = Date.now()
    const payCall = (prisma.payment.create as AnyJest).mock.calls[0][0]
    expect(payCall.data.paidAt).toBeInstanceOf(Date)
    expect(payCall.data.paidAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(payCall.data.paidAt.getTime()).toBeLessThanOrEqual(after)
  })
})

// ── OrderStatusHistory ───────────────────────────────────────

describe('OrdersService.createFromMarketplace — order status history', () => {
  it('source="marketplace", fromStatus=null, toStatus="confirmed"', async () => {
    const prisma = buildPrisma()
    const svc = buildService(prisma)
    await svc.createFromMarketplace(buildDraft(), buildBuyer(), 'EBAY', 'EX-16', 'corr-16')
    expect(prisma.orderStatusHistory.create).toHaveBeenCalledTimes(1)
    const histCall = (prisma.orderStatusHistory.create as AnyJest).mock.calls[0][0]
    expect(histCall.data.source).toBe('marketplace')
    expect(histCall.data.fromStatus).toBeNull()
    expect(histCall.data.toStatus).toBe('confirmed')
    expect(histCall.data.createdBy).toBe('marketplace-import')
  })
})

// ── Event Emission ───────────────────────────────────────────

describe('OrdersService.createFromMarketplace — event emission', () => {
  it('emits MarketplaceOrderImportedEvent after tx commit', async () => {
    const prisma = buildPrisma()
    const ee = buildEventEmitter()
    const svc = buildService(prisma, ee)
    await svc.createFromMarketplace(buildDraft(), buildBuyer(), 'EBAY', 'EX-17', 'corr-17')
    expect(ee.emitAsync).toHaveBeenCalledTimes(1)
    expect(ee.emitAsync.mock.calls[0][0]).toBe(MARKETPLACE_ORDER_EVENTS.IMPORTED)
  })

  it('event payload shape matches contract', async () => {
    const prisma = buildPrisma()
    const ee = buildEventEmitter()
    const svc = buildService(prisma, ee)
    await svc.createFromMarketplace(buildDraft(), buildBuyer(), 'EBAY', 'EX-18', 'corr-18')
    const evt = ee.emitAsync.mock.calls[0][1]
    expect(evt.orderId).toBe('order-1')
    expect(evt.marketplace).toBe('EBAY')
    expect(evt.externalOrderId).toBe('EX-18')
    expect(evt.correlationId).toBe('corr-18')
    expect(evt.items).toHaveLength(1)
    expect(evt.items[0].variantId).toBe('variant-1')
    expect(evt.items[0].quantity).toBe(1)
    expect(typeof evt.items[0].reservationSessionId).toBe('string')
  })
})

// ── Duplicate Handling ───────────────────────────────────────

describe('OrdersService.createFromMarketplace — duplicate handling', () => {
  it('P2002 → DuplicateOrderException(externalOrderId)', async () => {
    const prisma = buildPrisma()
    ;(prisma.$transaction as AnyJest).mockRejectedValue({ code: 'P2002' })
    const svc = buildService(prisma)
    await expect(
      svc.createFromMarketplace(buildDraft(), buildBuyer(), 'EBAY', 'EX-DUP', 'corr-dup'),
    ).rejects.toBeInstanceOf(DuplicateOrderException)
  })

  it('non-P2002 errors bubble up unchanged', async () => {
    const prisma = buildPrisma()
    const otherErr = new Error('connection lost')
    ;(prisma.$transaction as AnyJest).mockRejectedValue(otherErr)
    const svc = buildService(prisma)
    await expect(
      svc.createFromMarketplace(buildDraft(), buildBuyer(), 'EBAY', 'EX-NET', 'corr-net'),
    ).rejects.toBe(otherErr)
  })
})
