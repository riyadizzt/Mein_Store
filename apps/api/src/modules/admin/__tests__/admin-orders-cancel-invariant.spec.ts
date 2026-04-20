/**
 * Regression for the ORD-20260420-000001 partial-cancel math bug.
 *
 * Root cause: admin-orders.service.cancelItems computed
 *   newTax   = newSubtotal × 0.19          (adds tax on top — Netto convention)
 *   newTotal = newSubtotal + shipping + newTax
 *   newDiscount = order.discountAmount     (unchanged — no proportional scaling)
 *
 * In a Brutto shop (CLAUDE.md: "MwSt wird RAUSGERECHNET, nicht draufaddiert"),
 * that produced:
 *   newTotal    = 725.90  (should be 305.00)
 *   newTax      = 115.90  (should be 48.70)
 *   newDiscount = 9785.00 (should be 305.00)
 * …breaking the invariant newSubtotal − newDiscount + shipping = newTotal.
 *
 * Finance reports that aggregate order.totalAmount / order.taxAmount would
 * then double-count the partial-cancel delta. Same root-cause family as
 * Invoice.netAmount (8bd0eb0) and VAT-Report (476bb87).
 *
 * What this spec pins:
 *   1. For a 50%-coupon partial cancel, newTotal = oldTotal − refund,
 *      newTax = newTotal − newTotal/1.19 (Brutto rausgerechnet),
 *      newDiscount derived so the invariant holds.
 *   2. The invariant assertion is the permanent shape of the data, not
 *      an accident of one test case — a second scenario (fixed-amount
 *      coupon) also satisfies it.
 *   3. Meta-verifiable: reverting to newTax = newSubtotal × 0.19 breaks
 *      test #1 immediately.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { AdminOrdersService } from '../services/admin-orders.service'
import { AuditService } from '../services/audit.service'
import { NotificationService } from '../services/notification.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { PaymentsService } from '../../payments/payments.service'
import { ShipmentsService } from '../../shipments/shipments.service'
import { EmailService } from '../../email/email.service'
import { ReservationService } from '../../inventory/reservation.service'

// Capture what we wrote to order.update so the test can assert on the
// persisted totals without reaching into Prisma internals.
type OrderUpdateCapture = { data: any } | null

function buildPrisma(order: any) {
  const capture: { latest: OrderUpdateCapture } = { latest: null }
  const mock: any = {
    order: {
      findFirst: jest.fn().mockResolvedValue(order),
      findUnique: jest.fn().mockResolvedValue(order),
      update: jest.fn().mockImplementation(async (args: any) => {
        capture.latest = { data: args.data }
        return { ...order, ...args.data }
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    orderItem: {
      update: jest.fn().mockResolvedValue({}),
    },
    orderStatusHistory: {
      create: jest.fn().mockResolvedValue({}),
    },
    // cancelItems delegates refund creation to PaymentsService; no direct
    // refund table access needed here.
  }
  return { mock, capture }
}

async function makeService(prisma: any, extras: Partial<{ paymentsService: any; reservationService: any }> = {}) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AdminOrdersService,
      { provide: PrismaService, useValue: prisma },
      { provide: AuditService, useValue: { log: jest.fn() } },
      { provide: NotificationService, useValue: { create: jest.fn(), createForAllAdmins: jest.fn() } },
      { provide: PaymentsService, useValue: extras.paymentsService ?? { createRefund: jest.fn().mockResolvedValue({}) } },
      { provide: ShipmentsService, useValue: {} },
      { provide: EmailService, useValue: { enqueue: jest.fn() } },
      { provide: EventEmitter2, useValue: { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) } },
      { provide: ReservationService, useValue: extras.reservationService ?? { release: jest.fn().mockResolvedValue(undefined) } },
    ],
  }).compile()
  return module.get(AdminOrdersService)
}

// Minimal order shape — only the fields cancelItems reads.
function buildOrder(opts: {
  subtotal: number
  totalAmount: number
  discountAmount: number
  shippingCost?: number
  items: Array<{ id: string; unitPrice: number; quantity: number; totalPrice: number }>
}) {
  return {
    id: 'order-1',
    orderNumber: 'ORD-20260420-000001',
    deletedAt: null,
    status: 'delivered',
    subtotal: opts.subtotal,
    totalAmount: opts.totalAmount,
    taxAmount: opts.totalAmount - opts.totalAmount / 1.19,
    discountAmount: opts.discountAmount,
    shippingCost: opts.shippingCost ?? 0,
    items: opts.items,
    payment: { id: 'pay-1', status: 'captured', provider: 'STRIPE' },
    user: { id: 'user-1', email: 'test@test.invalid', firstName: 'Test', preferredLang: 'de' },
  }
}

describe('AdminOrdersService.cancelItems — Brutto math + invariant (ORD-20260420-000001)', () => {
  it('#1 50% coupon, cancel €18960 of €19570 items: newTotal=305, newTax=48.70, invariant holds', async () => {
    // Exact ORD-20260420-000001 scenario:
    //   Pre-cancel: subtotal=19570, discount=9785 (50%), total=9785, tax=1562.31
    //   Cancel everything except €610 of items (pre-discount Brutto)
    //   Proportional refund = (18960 / 19570) * (9785 - 0) = 9480
    //   Post-cancel: newSubtotal=610, newTotal=305, newTax=48.70, newDiscount=305
    const items = [
      { id: 'item-1', unitPrice: 61, quantity: 10, totalPrice: 610 }, // remains
      { id: 'item-2', unitPrice: 1580, quantity: 6, totalPrice: 9480 }, // cancelled
      { id: 'item-3', unitPrice: 1580, quantity: 6, totalPrice: 9480 }, // cancelled
    ]
    const order = buildOrder({
      subtotal: 19570,
      totalAmount: 9785,
      discountAmount: 9785,
      shippingCost: 0,
      items,
    })
    const { mock, capture } = buildPrisma(order)
    const service = await makeService(mock)

    await service.cancelItems('order-1', ['item-2', 'item-3'], 'وزن', 'admin-1', '127.0.0.1')

    expect(capture.latest).not.toBeNull()
    const persisted = capture.latest!.data

    // Exact values
    expect(persisted.subtotal).toBe(610)
    expect(persisted.totalAmount).toBe(305)
    expect(persisted.taxAmount).toBeCloseTo(48.70, 2)
    expect(persisted.discountAmount).toBe(305)

    // INVARIANT: newSubtotal − newDiscount + shipping = newTotal (1 cent tolerance)
    const shipping = Number(order.shippingCost)
    const invariantDrift = Math.abs(
      persisted.subtotal - persisted.discountAmount + shipping - persisted.totalAmount,
    )
    expect(invariantDrift).toBeLessThanOrEqual(0.02)
  })

  it('#2 Fixed-amount coupon (€10 off €100): partial cancel preserves invariant', async () => {
    // Pre-cancel: subtotal=100, discount=10, total=90 (shipping=0)
    // Cancel half the items (€50 pre-discount)
    //   ratio = 50/100 = 0.5 → refund = 0.5 * (90 - 0) = 45
    // Post-cancel: newSubtotal=50, newTotal=45, newTax=45-45/1.19≈7.18,
    //              newDiscount = 50 + 0 - 45 = 5 (the half of €10 coupon that
    //              was "used up" by the remaining items).
    const items = [
      { id: 'item-a', unitPrice: 50, quantity: 1, totalPrice: 50 }, // remains
      { id: 'item-b', unitPrice: 50, quantity: 1, totalPrice: 50 }, // cancelled
    ]
    const order = buildOrder({
      subtotal: 100,
      totalAmount: 90,
      discountAmount: 10,
      shippingCost: 0,
      items,
    })
    const { mock, capture } = buildPrisma(order)
    const service = await makeService(mock)

    await service.cancelItems('order-1', ['item-b'], 'test', 'admin-1', '127.0.0.1')

    const persisted = capture.latest!.data
    expect(persisted.subtotal).toBe(50)
    expect(persisted.totalAmount).toBe(45)
    expect(persisted.taxAmount).toBeCloseTo(7.18, 2)
    expect(persisted.discountAmount).toBe(5)

    // INVARIANT
    const drift = Math.abs(
      persisted.subtotal - persisted.discountAmount + 0 - persisted.totalAmount,
    )
    expect(drift).toBeLessThanOrEqual(0.02)
  })

  it('#3 No coupon, cancel half: newDiscount stays 0 and invariant holds', async () => {
    // Regression safety — ensure the derivation doesn't introduce a phantom
    // discount when none existed.
    const items = [
      { id: 'item-a', unitPrice: 50, quantity: 1, totalPrice: 50 },
      { id: 'item-b', unitPrice: 50, quantity: 1, totalPrice: 50 },
    ]
    const order = buildOrder({
      subtotal: 100,
      totalAmount: 100,
      discountAmount: 0,
      shippingCost: 0,
      items,
    })
    const { mock, capture } = buildPrisma(order)
    const service = await makeService(mock)

    await service.cancelItems('order-1', ['item-b'], 'test', 'admin-1', '127.0.0.1')

    const persisted = capture.latest!.data
    expect(persisted.subtotal).toBe(50)
    expect(persisted.totalAmount).toBe(50)
    expect(persisted.taxAmount).toBeCloseTo(7.98, 2)
    expect(persisted.discountAmount).toBe(0)

    const drift = Math.abs(
      persisted.subtotal - persisted.discountAmount + 0 - persisted.totalAmount,
    )
    expect(drift).toBeLessThanOrEqual(0.02)
  })

  it('#4 With shipping: invariant still includes shipping correctly', async () => {
    // Pre-cancel: subtotal=200, discount=0, shipping=5, total=205
    // Cancel half: newSubtotal=100, refund = (100/200) * (205-5) = 100
    // Post: newTotal=205-100=105, newDiscount = 100 + 5 - 105 = 0
    const items = [
      { id: 'item-a', unitPrice: 100, quantity: 1, totalPrice: 100 },
      { id: 'item-b', unitPrice: 100, quantity: 1, totalPrice: 100 },
    ]
    const order = buildOrder({
      subtotal: 200,
      totalAmount: 205,
      discountAmount: 0,
      shippingCost: 5,
      items,
    })
    const { mock, capture } = buildPrisma(order)
    const service = await makeService(mock)

    await service.cancelItems('order-1', ['item-b'], 'test', 'admin-1', '127.0.0.1')

    const persisted = capture.latest!.data
    expect(persisted.subtotal).toBe(100)
    expect(persisted.totalAmount).toBe(105)
    expect(persisted.discountAmount).toBe(0)

    const drift = Math.abs(persisted.subtotal - persisted.discountAmount + 5 - persisted.totalAmount)
    expect(drift).toBeLessThanOrEqual(0.02)
  })
})
