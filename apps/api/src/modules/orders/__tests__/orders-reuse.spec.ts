/**
 * Tests for the order REUSE-pending logic.
 *
 * Pins the contract of `findReusableOrder` (private but tested through `create`):
 *   - Reuses pending/pending_payment orders when EVERYTHING matches
 *   - Strict: items, address, coupon, freshness, user identity
 *   - Never reuses paid orders (authorized/captured) — money safety
 *   - Never reuses cancelled/older orders
 */

import { Test, TestingModule } from '@nestjs/testing'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { OrdersService } from '../orders.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { IdempotencyService } from '../idempotency.service'
import { SHIPPING_CALCULATOR } from '../shipping/shipping-calculator.interface'

const mockPrisma: any = {
  order: { findMany: jest.fn(), findUnique: jest.fn() },
  // findReusableOrder looks up stub users by email when resolving guest
  // identity (added with the 14.04.2026 bug-5 fix). Default: no match,
  // falls back to the legacy guestEmail WHERE clause. Individual tests
  // override this when they need to assert stub-user resolution.
  user: { findUnique: jest.fn().mockResolvedValue(null) },
}

const mockIdempotency = {
  hashBody: jest.fn().mockReturnValue('hash-x'),
  get: jest.fn().mockResolvedValue(null),
  reserve: jest.fn().mockResolvedValue(undefined),
  save: jest.fn().mockResolvedValue(undefined),
}

const mockShipping = { calculate: jest.fn() }
const mockEvents = { emit: jest.fn(), emitAsync: jest.fn() }

async function makeService() {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      OrdersService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: IdempotencyService, useValue: mockIdempotency },
      { provide: EventEmitter2, useValue: mockEvents },
      { provide: SHIPPING_CALCULATOR, useValue: mockShipping },
    ],
  }).compile()
  return module.get<OrdersService>(OrdersService)
}

// Reach into the service to call the private helper directly — keeps tests focused
// without firing the entire create() pipeline.
async function callFindReusable(svc: OrdersService, dto: any, userId: string | null) {
  return (svc as any).findReusableOrder(dto, userId)
}

const baseAddr = {
  firstName: 'Anna', lastName: 'M',
  street: 'Pannierstr', houseNumber: '4',
  postalCode: '12047', city: 'Berlin', country: 'DE',
}

const baseCart = [
  { variantId: 'var-1', quantity: 2 },
  { variantId: 'var-2', quantity: 1 },
]

const makePendingOrder = (overrides: any = {}) => ({
  id: 'order-existing',
  orderNumber: 'ORD-2026-00001',
  status: 'pending_payment',
  createdAt: new Date(), // fresh
  couponCode: null,
  shippingAddressId: null,
  shippingAddress: { ...baseAddr },
  items: [
    { variantId: 'var-1', quantity: 2 },
    { variantId: 'var-2', quantity: 1 },
  ],
  payment: { status: 'pending' },
  ...overrides,
})

describe('OrdersService.findReusableOrder', () => {
  let svc: OrdersService
  beforeEach(async () => {
    jest.clearAllMocks()
    svc = await makeService()
  })

  // ── Happy path ───────────────────────────────────────────
  describe('Reuses when everything matches', () => {
    it('reuses for the same userId + same items + same inline address', async () => {
      mockPrisma.order.findMany.mockResolvedValue([makePendingOrder()])
      const result = await callFindReusable(svc, {
        items: baseCart,
        shippingAddress: baseAddr,
      }, 'user-1')
      expect(result?.id).toBe('order-existing')
    })

    it('reuses for guest with same email', async () => {
      mockPrisma.order.findMany.mockResolvedValue([makePendingOrder()])
      const result = await callFindReusable(svc, {
        items: baseCart,
        shippingAddress: baseAddr,
        guestEmail: 'guest@example.com',
      }, null)
      expect(result?.id).toBe('order-existing')
    })

    it('reuses for saved address id (savedAddressId)', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        makePendingOrder({ shippingAddressId: 'addr-99', shippingAddress: null }),
      ])
      const result = await callFindReusable(svc, {
        items: baseCart,
        shippingAddressId: 'addr-99',
      }, 'user-1')
      expect(result?.id).toBe('order-existing')
    })

    it('reuses for plain pending status (not just pending_payment)', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        makePendingOrder({ status: 'pending' }),
      ])
      const result = await callFindReusable(svc, {
        items: baseCart, shippingAddress: baseAddr,
      }, 'user-1')
      expect(result?.id).toBe('order-existing')
    })

    it('reuses for matching coupon', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        makePendingOrder({ couponCode: 'WELCOME10' }),
      ])
      const result = await callFindReusable(svc, {
        items: baseCart, shippingAddress: baseAddr, couponCode: 'WELCOME10',
      }, 'user-1')
      expect(result?.id).toBe('order-existing')
    })

    it('reuses regardless of item order in cart (sorted match)', async () => {
      mockPrisma.order.findMany.mockResolvedValue([makePendingOrder()])
      const result = await callFindReusable(svc, {
        // reverse order
        items: [{ variantId: 'var-2', quantity: 1 }, { variantId: 'var-1', quantity: 2 }],
        shippingAddress: baseAddr,
      }, 'user-1')
      expect(result?.id).toBe('order-existing')
    })
  })

  // ── No-reuse: cart differs ───────────────────────────────
  describe('Does NOT reuse when cart differs', () => {
    it('different quantity → no reuse', async () => {
      mockPrisma.order.findMany.mockResolvedValue([makePendingOrder()])
      const result = await callFindReusable(svc, {
        items: [
          { variantId: 'var-1', quantity: 3 }, // was 2
          { variantId: 'var-2', quantity: 1 },
        ],
        shippingAddress: baseAddr,
      }, 'user-1')
      expect(result).toBeNull()
    })

    it('extra item → no reuse', async () => {
      mockPrisma.order.findMany.mockResolvedValue([makePendingOrder()])
      const result = await callFindReusable(svc, {
        items: [
          { variantId: 'var-1', quantity: 2 },
          { variantId: 'var-2', quantity: 1 },
          { variantId: 'var-3', quantity: 1 }, // new item
        ],
        shippingAddress: baseAddr,
      }, 'user-1')
      expect(result).toBeNull()
    })

    it('missing item → no reuse', async () => {
      mockPrisma.order.findMany.mockResolvedValue([makePendingOrder()])
      const result = await callFindReusable(svc, {
        items: [{ variantId: 'var-1', quantity: 2 }],
        shippingAddress: baseAddr,
      }, 'user-1')
      expect(result).toBeNull()
    })

    it('different variantId → no reuse', async () => {
      mockPrisma.order.findMany.mockResolvedValue([makePendingOrder()])
      const result = await callFindReusable(svc, {
        items: [
          { variantId: 'var-99', quantity: 2 }, // different
          { variantId: 'var-2', quantity: 1 },
        ],
        shippingAddress: baseAddr,
      }, 'user-1')
      expect(result).toBeNull()
    })
  })

  // ── No-reuse: address differs ────────────────────────────
  describe('Does NOT reuse when address differs', () => {
    it('different city → no reuse', async () => {
      mockPrisma.order.findMany.mockResolvedValue([makePendingOrder()])
      const result = await callFindReusable(svc, {
        items: baseCart,
        shippingAddress: { ...baseAddr, city: 'München' },
      }, 'user-1')
      expect(result).toBeNull()
    })

    it('different street → no reuse', async () => {
      mockPrisma.order.findMany.mockResolvedValue([makePendingOrder()])
      const result = await callFindReusable(svc, {
        items: baseCart,
        shippingAddress: { ...baseAddr, street: 'Other Street' },
      }, 'user-1')
      expect(result).toBeNull()
    })

    it('saved-address id mismatch → no reuse', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        makePendingOrder({ shippingAddressId: 'addr-1' }),
      ])
      const result = await callFindReusable(svc, {
        items: baseCart, shippingAddressId: 'addr-2', // different id
      }, 'user-1')
      expect(result).toBeNull()
    })

    it('inline + no saved-address fallback → no reuse if neither given', async () => {
      mockPrisma.order.findMany.mockResolvedValue([makePendingOrder()])
      const result = await callFindReusable(svc, {
        items: baseCart, // no address at all
      }, 'user-1')
      expect(result).toBeNull()
    })
  })

  // ── No-reuse: coupon differs ─────────────────────────────
  describe('Does NOT reuse when coupon differs', () => {
    it('order has coupon, request has none → no reuse', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        makePendingOrder({ couponCode: 'WELCOME10' }),
      ])
      const result = await callFindReusable(svc, {
        items: baseCart, shippingAddress: baseAddr,
      }, 'user-1')
      expect(result).toBeNull()
    })

    it('order has no coupon, request has one → no reuse', async () => {
      mockPrisma.order.findMany.mockResolvedValue([makePendingOrder()])
      const result = await callFindReusable(svc, {
        items: baseCart, shippingAddress: baseAddr, couponCode: 'WELCOME10',
      }, 'user-1')
      expect(result).toBeNull()
    })

    it('different coupon code → no reuse', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        makePendingOrder({ couponCode: 'WELCOME10' }),
      ])
      const result = await callFindReusable(svc, {
        items: baseCart, shippingAddress: baseAddr, couponCode: 'OTHER',
      }, 'user-1')
      expect(result).toBeNull()
    })
  })

  // ── No-reuse: payment guard (CRITICAL — money safety) ────
  describe('Does NOT reuse paid orders (money safety)', () => {
    it('payment captured → no reuse', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        makePendingOrder({ payment: { status: 'captured' } }),
      ])
      const result = await callFindReusable(svc, {
        items: baseCart, shippingAddress: baseAddr,
      }, 'user-1')
      expect(result).toBeNull()
    })

    it('payment authorized → no reuse', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        makePendingOrder({ payment: { status: 'authorized' } }),
      ])
      const result = await callFindReusable(svc, {
        items: baseCart, shippingAddress: baseAddr,
      }, 'user-1')
      expect(result).toBeNull()
    })

    it('payment failed → can be reused (it failed, so retry is fine)', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        makePendingOrder({ payment: { status: 'failed' } }),
      ])
      const result = await callFindReusable(svc, {
        items: baseCart, shippingAddress: baseAddr,
      }, 'user-1')
      expect(result?.id).toBe('order-existing')
    })

    it('no payment row at all → can be reused', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        makePendingOrder({ payment: null }),
      ])
      const result = await callFindReusable(svc, {
        items: baseCart, shippingAddress: baseAddr,
      }, 'user-1')
      expect(result?.id).toBe('order-existing')
    })
  })

  // ── No-reuse: identity safety ────────────────────────────
  describe('Does NOT reuse across users', () => {
    it('different userId → query returns nothing (handled by where clause)', async () => {
      // Query will return empty for userId='user-2' if existing order is for user-1
      mockPrisma.order.findMany.mockResolvedValue([])
      const result = await callFindReusable(svc, {
        items: baseCart, shippingAddress: baseAddr,
      }, 'user-2')
      expect(result).toBeNull()
    })

    it('anonymous (no userId, no guestEmail) → never reuses', async () => {
      const result = await callFindReusable(svc, {
        items: baseCart, shippingAddress: baseAddr,
      }, null)
      // Should not even query
      expect(mockPrisma.order.findMany).not.toHaveBeenCalled()
      expect(result).toBeNull()
    })

    it('guestEmail matched case-insensitively', async () => {
      mockPrisma.order.findMany.mockResolvedValue([makePendingOrder()])
      const result = await callFindReusable(svc, {
        items: baseCart, shippingAddress: baseAddr, guestEmail: 'GUEST@Example.COM',
      }, null)
      // Service should lowercase the email when querying
      const callArgs = mockPrisma.order.findMany.mock.calls[0][0]
      expect(callArgs.where.guestEmail).toBe('guest@example.com')
      expect(result?.id).toBe('order-existing')
    })
  })

  // ── No-reuse: edge cases ─────────────────────────────────
  describe('Edge cases', () => {
    it('empty candidate list → null', async () => {
      mockPrisma.order.findMany.mockResolvedValue([])
      const result = await callFindReusable(svc, {
        items: baseCart, shippingAddress: baseAddr,
      }, 'user-1')
      expect(result).toBeNull()
    })

    it('multiple candidates: picks the first matching one', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        makePendingOrder({ id: 'order-A', payment: { status: 'captured' } }), // skipped
        makePendingOrder({ id: 'order-B', orderNumber: 'ORD-B' }), // matches
        makePendingOrder({ id: 'order-C', orderNumber: 'ORD-C' }),
      ])
      const result = await callFindReusable(svc, {
        items: baseCart, shippingAddress: baseAddr,
      }, 'user-1')
      expect(result?.id).toBe('order-B')
    })

    it('time cutoff: query passes a 15-min cutoff in the where clause', async () => {
      mockPrisma.order.findMany.mockResolvedValue([])
      await callFindReusable(svc, {
        items: baseCart, shippingAddress: baseAddr,
      }, 'user-1')
      const callArgs = mockPrisma.order.findMany.mock.calls[0][0]
      const cutoff = callArgs.where.createdAt.gte as Date
      const minutesAgo = (Date.now() - cutoff.getTime()) / 60000
      expect(minutesAgo).toBeGreaterThanOrEqual(14.9)
      expect(minutesAgo).toBeLessThanOrEqual(15.1)
    })

    it('only queries pending and pending_payment statuses', async () => {
      mockPrisma.order.findMany.mockResolvedValue([])
      await callFindReusable(svc, {
        items: baseCart, shippingAddress: baseAddr,
      }, 'user-1')
      const callArgs = mockPrisma.order.findMany.mock.calls[0][0]
      expect(callArgs.where.status).toEqual({ in: ['pending', 'pending_payment'] })
    })
  })
})
