/**
 * Backend security regression for the Coupon-UX bug chain discovered in the
 * 18.04 live test (ORD-20260418-000001 had couponCode=NULL despite the
 * customer entering 50MALAK).
 *
 * Root causes this spec pins down:
 *
 *   1. CouponUsage.create was missing userId + email → validateCoupon's
 *      onePerCustomer guard (WHERE couponId AND (userId=X OR email=X))
 *      could never match a previous usage, effectively disabling
 *      onePerCustomer for every coupon. Tests #8 + #9.
 *
 *   2. Order-create had its own weak validation that skipped onePerCustomer,
 *      startAt, email-abuse. When the user's frontend submitted a coupon that
 *      would fail validateCoupon, this weaker check either accepted it or
 *      silently fell through (dropping the coupon without any error).
 *      Tests #2-#6 assert every validateCoupon rejection path now throws a
 *      structured 400 CouponRejected at order-create.
 *
 *   3. A valid coupon path (#1 + #7) must still work — no regression.
 *
 * Meta-verifiable: temporarily removing the `await marketingService.
 * validateCoupon` call or swapping the throw with a silent return breaks
 * tests #2-#6 immediately, proving the guard is structural.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { BadRequestException } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { OrdersService } from '../orders.service'
import { IdempotencyService } from '../idempotency.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { SHIPPING_CALCULATOR } from '../shipping/shipping-calculator.interface'
import { AdminMarketingService } from '../../admin/services/admin-marketing.service'

// ── Prisma mock shape — matches the shape used in orders.service.spec.ts
// so the order.create happy-path flows through. The coupon tests only care
// about the validateCoupon branch; everything else (inventory, warehouse,
// reservations, etc.) is mocked to trivially-succeed.
function buildPrisma() {
  const m: any = {
    productVariant: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'v1',
          sku: 'SKU-001',
          isActive: true,
          priceModifier: 0,
          weightGrams: 500,
          product: {
            basePrice: 50,
            salePrice: null,
            taxRate: 19,
            translations: [{ name: 'Produkt SKU-001' }],
          },
        },
      ]),
      findUnique: jest.fn().mockResolvedValue({
        sku: 'SKU-001',
        color: 'Schwarz',
        size: 'M',
        product: { translations: [] },
      }),
    },
    order: {
      create: jest.fn().mockResolvedValue({
        id: 'order-created',
        orderNumber: 'ORD-20260418-TEST',
        status: 'pending',
      }),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    orderItem: { findMany: jest.fn().mockResolvedValue([]) },
    orderStatusHistory: { create: jest.fn() },
    coupon: {
      findFirst: jest.fn().mockResolvedValue({ id: 'c1', code: 'MOCK' }),
      update: jest.fn().mockResolvedValue({}),
    },
    couponUsage: {
      create: jest.fn().mockResolvedValue({ id: 'cu1' }),
    },
    address: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'addr-test' }),
    },
    warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'wh1', isDefault: true, isActive: true }) },
    inventory: {
      findFirst: jest.fn().mockResolvedValue({ id: 'inv1', quantityOnHand: 100, quantityReserved: 0 }),
      // Auto-resolve warehouse loop expects `warehouse` relation included.
      // One warehouse with plenty of stock keeps the flow moving without
      // hitting the stock-insufficiency branch.
      findMany: jest.fn().mockResolvedValue([
        {
          warehouseId: 'wh1',
          quantityOnHand: 100,
          quantityReserved: 0,
          warehouse: { isDefault: true },
        },
      ]),
      updateMany: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _sum: { quantityOnHand: 100, quantityReserved: 0 } }),
    },
    stockReservation: { findMany: jest.fn().mockResolvedValue([]) },
    // Guest-checkout path hits user.findUnique + user.create (stub-user pattern).
    // Tests #9 and the happy-paths with guestEmail trigger this branch.
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        id: 'stub-user-id',
        email: 'stub@test.invalid',
        firstName: 'Stub',
        preferredLang: 'de',
      }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    idempotencyKey: { deleteMany: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([{ seq: 1 }]),
  }
  m.$transaction = jest.fn().mockImplementation((fn: any) =>
    typeof fn === 'function' ? fn(m) : Promise.all(fn),
  )
  return m
}

async function makeService(marketingMock: any) {
  const mockPrisma = buildPrisma()
  const mockIdempotency = {
    // These tests don't pass idempotencyKey so get/reserve/save are never
    // called — only hashBody runs on every create. Return a deterministic
    // hash so any debug log stays clean.
    hashBody: jest.fn().mockReturnValue('test-hash'),
    get: jest.fn().mockResolvedValue(null),
    reserve: jest.fn().mockResolvedValue(undefined),
    save: jest.fn().mockResolvedValue(undefined),
  }
  const mockEvents = { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([[]]) }
  const mockShipping = {
    calculate: jest.fn().mockResolvedValue({
      cost: 4.99,
      zoneName: 'Deutschland',
      isFreeShipping: false,
      carrier: 'zone_based',
    }),
  }

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      OrdersService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: EventEmitter2, useValue: mockEvents },
      { provide: IdempotencyService, useValue: mockIdempotency },
      { provide: SHIPPING_CALCULATOR, useValue: mockShipping },
      { provide: AdminMarketingService, useValue: marketingMock },
    ],
  }).compile()

  return {
    service: module.get<OrdersService>(OrdersService),
    prisma: mockPrisma,
  }
}

// Base DTO for a 1-item order. Individual tests override couponCode / guestEmail.
function baseDto(overrides: any = {}) {
  return {
    items: [{ variantId: 'v1', quantity: 1 }],
    countryCode: 'DE',
    channel: 'website',
    shippingAddress: {
      firstName: 'Anna',
      lastName: 'Test',
      street: 'Pannierstr.',
      houseNumber: '4',
      postalCode: '12047',
      city: 'Berlin',
      country: 'DE',
    },
    guestEmail: 'buyer@test.invalid',
    ...overrides,
  }
}

describe('OrdersService.create — Coupon enforcement (Commit A.2 Backend Security)', () => {
  // ── #2-#6: every validateCoupon reasonCode triggers a structured 400 ──

  it('#2 onePerCustomer rejection → 400 CouponRejected reasonCode=one_per_customer', async () => {
    const marketing = {
      validateCoupon: jest.fn().mockResolvedValue({
        valid: false,
        reasonCode: 'one_per_customer',
        reason: { de: 'Sie haben …', en: 'You have …', ar: 'لقد …' },
      }),
    }
    const { service } = await makeService(marketing)

    let caught: any = null
    try {
      await service.create(baseDto({ couponCode: 'REPEAT' }), null, 'test-corr-id')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(BadRequestException)
    expect(caught.response?.error).toBe('CouponRejected')
    expect(caught.response?.reasonCode).toBe('one_per_customer')
    expect(caught.response?.message?.de).toBeTruthy()
    expect(caught.response?.message?.en).toBeTruthy()
    expect(caught.response?.message?.ar).toBeTruthy()
    expect(caught.response?.data?.couponCode).toBe('REPEAT')
  })

  it('#3 expired coupon → 400 reasonCode=expired', async () => {
    const marketing = {
      validateCoupon: jest.fn().mockResolvedValue({
        valid: false,
        reasonCode: 'expired',
        reason: { de: 'abgelaufen', en: 'expired', ar: 'منتهي' },
      }),
    }
    const { service } = await makeService(marketing)
    await expect(
      service.create(baseDto({ couponCode: 'OLD' }), null, 'test-corr-id'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        error: 'CouponRejected',
        reasonCode: 'expired',
      }),
    })
  })

  it('#4 not_yet_started → 400 reasonCode=not_yet_started', async () => {
    const marketing = {
      validateCoupon: jest.fn().mockResolvedValue({
        valid: false,
        reasonCode: 'not_yet_started',
        reason: { de: 'x', en: 'x', ar: 'x' },
      }),
    }
    const { service } = await makeService(marketing)
    await expect(
      service.create(baseDto({ couponCode: 'EARLY' }), null, 'test-corr-id'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ reasonCode: 'not_yet_started' }),
    })
  })

  it('#5 min_order rejection → 400 reasonCode=min_order', async () => {
    const marketing = {
      validateCoupon: jest.fn().mockResolvedValue({
        valid: false,
        reasonCode: 'min_order',
        reason: { de: 'min', en: 'min', ar: 'min' },
      }),
    }
    const { service } = await makeService(marketing)
    await expect(
      service.create(baseDto({ couponCode: 'BIG' }), null, 'test-corr-id'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ reasonCode: 'min_order' }),
    })
  })

  it('#6 not_active → 400 reasonCode=not_active', async () => {
    const marketing = {
      validateCoupon: jest.fn().mockResolvedValue({
        valid: false,
        reasonCode: 'not_active',
        reason: { de: 'x', en: 'x', ar: 'x' },
      }),
    }
    const { service } = await makeService(marketing)
    await expect(
      service.create(baseDto({ couponCode: 'OFF' }), null, 'test-corr-id'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ reasonCode: 'not_active' }),
    })
  })

  // ── #7: no coupon at all → no validation call, happy path ──

  it('#7 no couponCode in payload → validateCoupon never called, order succeeds', async () => {
    const marketing = { validateCoupon: jest.fn() }
    const { service } = await makeService(marketing)
    await service.create(baseDto(/* no couponCode */), null, 'test-corr-id')
    expect(marketing.validateCoupon).not.toHaveBeenCalled()
  })

  // ── #1, #8, #9: valid coupon path + CouponUsage.create payload shape ──

  it('#1 valid coupon → applied + CouponUsage.create called', async () => {
    const marketing = {
      validateCoupon: jest.fn().mockResolvedValue({
        valid: true,
        coupon: {
          code: 'SAVE10',
          type: 'percentage',
          discountPercent: 10,
          discountAmount: null,
          freeShipping: false,
          description: null,
        },
      }),
    }
    const { service, prisma } = await makeService(marketing)
    await service.create(baseDto({ couponCode: 'SAVE10' }), null, 'test-corr-id')
    expect(marketing.validateCoupon).toHaveBeenCalledWith('SAVE10', expect.any(Object))
    expect(prisma.couponUsage.create).toHaveBeenCalled()
  })

  it('#8 valid coupon + userId set → CouponUsage.create writes userId + email (defense-in-depth)', async () => {
    const marketing = {
      validateCoupon: jest.fn().mockResolvedValue({
        valid: true,
        coupon: {
          code: 'LOGGEDIN',
          type: 'percentage',
          discountPercent: 5,
          discountAmount: null,
          freeShipping: false,
          description: null,
        },
      }),
    }
    const { service, prisma } = await makeService(marketing)
    await service.create(baseDto({ couponCode: 'LOGGEDIN' }), 'user-abc', 'test-corr-id')
    const usageCalls = prisma.couponUsage.create.mock.calls
    expect(usageCalls.length).toBeGreaterThan(0)
    const payload = usageCalls[0][0].data
    expect(payload.userId).toBe('user-abc')
    // Since 20.04: email is ALWAYS persisted when dto.guestEmail is present
    // (stub-guest fix). For logged-in users the frontend normally omits
    // guestEmail, but if it does arrive, we still persist it so
    // validateCoupon's OR-lookup on (userId, email) has both match-keys.
    // Benign for identity because userId remains the primary identifier.
    expect(payload.email).toBe('buyer@test.invalid')
  })

  it('#8b valid coupon + userId set + no guestEmail → email stays null', async () => {
    // Real-world logged-in flow: frontend omits guestEmail entirely.
    // This test pins down that we don't fabricate an email from thin air.
    const marketing = {
      validateCoupon: jest.fn().mockResolvedValue({
        valid: true,
        coupon: {
          code: 'LOGGEDIN',
          type: 'percentage',
          discountPercent: 5,
          discountAmount: null,
          freeShipping: false,
          description: null,
        },
      }),
    }
    const { service, prisma } = await makeService(marketing)
    const dto = baseDto({ couponCode: 'LOGGEDIN' })
    delete (dto as any).guestEmail
    await service.create(dto, 'user-abc', 'test-corr-id')
    const payload = prisma.couponUsage.create.mock.calls[0][0].data
    expect(payload.userId).toBe('user-abc')
    expect(payload.email).toBeNull()
  })

  it('#9 valid coupon + guest-only → CouponUsage.create writes email (lower-cased), userId=null', async () => {
    const marketing = {
      validateCoupon: jest.fn().mockResolvedValue({
        valid: true,
        coupon: {
          code: 'GUEST',
          type: 'fixed_amount',
          discountPercent: null,
          discountAmount: 5,
          freeShipping: false,
          description: null,
        },
      }),
    }
    const { service, prisma } = await makeService(marketing)
    await service.create(
      baseDto({ couponCode: 'GUEST', guestEmail: 'Guest@Example.COM' }),
      null, // no userId → pure guest
      'test-corr-id',
    )
    const usageCalls = prisma.couponUsage.create.mock.calls
    expect(usageCalls.length).toBeGreaterThan(0)
    const payload = usageCalls[0][0].data
    expect(payload.userId).toBeNull()
    // Must be lower-cased + trimmed — matches how validateCoupon normalises
    // the lookup, otherwise the onePerCustomer check still can't match.
    expect(payload.email).toBe('guest@example.com')
  })
})
