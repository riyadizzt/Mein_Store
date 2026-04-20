/**
 * Regression for ORD-20260420-000001 invoice Netto bug.
 *
 * Root cause: InvoiceService.generateAndStoreInvoice() wrote
 *   netAmount = Number(order.subtotal)
 * which is the pre-discount line-item total, NOT the real net. On a
 * coupon order the net therefore inflated to the pre-discount subtotal
 * and the GoBD-relevant invoice Netto value was wrong by exactly the
 * discount amount.
 *
 * Fix: derive net from gross − tax (both server-calculated in
 * orders.service with MwSt rausgerechnet). Money-safe rounding to 2
 * decimals. Invariant `net + tax == gross` holds across all cases.
 *
 * Meta-verifiable: flipping the fix back to `Number(order.subtotal)`
 * makes all 4 tests fail. Currently green.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { InvoiceService } from '../invoice.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { StorageService } from '../../../common/services/storage.service'

// ── Mocks ────────────────────────────────────────────────────

function buildPrisma() {
  return {
    shopSetting: { findMany: jest.fn().mockResolvedValue([]) },
    order: { findFirst: jest.fn() },
    invoice: {
      create: jest.fn().mockImplementation((args: any) => Promise.resolve({ id: 'inv-new', ...args.data })),
    },
    // Sequence allocator for generateInvoiceNumber (RE-YYYY-NNNNN).
    // First call → seq=1.
    $queryRaw: jest.fn().mockResolvedValue([{ seq: 1 }]),
  }
}

function buildConfig() {
  return {
    get: jest.fn((_key: string, fallback?: string) => fallback ?? ''),
  }
}

function buildStorage() {
  return {
    uploadInvoicePdf: jest.fn().mockResolvedValue({ path: 'invoices/RE-test.pdf', signedUrl: 'https://storage/RE-test.pdf' }),
    downloadInvoicePdf: jest.fn().mockResolvedValue(Buffer.alloc(0)),
  }
}

// Build a realistic Prisma order shape that the PDF renderer can also
// consume without crashing. We only assert on the netAmount math here,
// but the pdf buildInvoicePdf call runs as part of the flow.
function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderNumber: 'ORD-20260420-TEST',
    subtotal: 100,
    shippingCost: 0,
    discountAmount: 0,
    taxAmount: 15.97,
    totalAmount: 100,
    currency: 'EUR',
    couponCode: null,
    status: 'confirmed',
    deletedAt: null,
    notes: null,
    shippingAddressSnapshot: null,
    items: [],
    payment: { method: 'stripe_card', paidAt: new Date('2026-04-20T12:00:00Z') },
    invoices: [],
    user: { firstName: 'Anna', lastName: 'Test', email: 'anna@test.invalid', preferredLang: 'de' },
    shippingAddress: {
      firstName: 'Anna',
      lastName: 'Test',
      street: 'Pannierstr.',
      houseNumber: '4',
      postalCode: '12047',
      city: 'Berlin',
      country: 'DE',
    },
    ...overrides,
  }
}

async function makeService() {
  const prisma = buildPrisma()
  const config = buildConfig()
  const storage = buildStorage()

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      InvoiceService,
      { provide: PrismaService, useValue: prisma },
      { provide: ConfigService, useValue: config },
      { provide: StorageService, useValue: storage },
    ],
  }).compile()

  return { service: module.get<InvoiceService>(InvoiceService), prisma, storage }
}

describe('InvoiceService — netAmount calc (ORD-20260420-000001 regression)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('#1 Coupon order (50% off): net = gross − tax, NOT subtotal', async () => {
    // ORD-20260420-000001 shape: subtotal=19570, discount=9785,
    // shipping=0, gross=9785, tax=1562.31 (MwSt rausgerechnet 19%).
    // Expected net = 9785 − 1562.31 = 8222.69. Old bug produced 19570.
    const { service, prisma } = await makeService()
    prisma.order.findFirst.mockResolvedValue(
      makeOrder({
        subtotal: 19570,
        discountAmount: 9785,
        shippingCost: 0,
        taxAmount: 1562.31,
        totalAmount: 9785,
        couponCode: '50MALAK',
      }),
    )

    await service.generateAndStoreInvoice('order-1')

    const created = prisma.invoice.create.mock.calls[0][0].data
    expect(created.grossAmount).toBe(9785)
    expect(created.taxAmount).toBe(1562.31)
    expect(created.netAmount).toBe(8222.69)  // NOT 19570
    // Invariant: net + tax = gross (1-cent tolerance for rounding)
    expect(Math.abs(created.netAmount + created.taxAmount - created.grossAmount)).toBeLessThanOrEqual(0.01)
  })

  it('#2 No-discount order: invariant net + tax = gross holds', async () => {
    // Full-price order, subtotal == gross. Net must still be derived
    // from gross−tax (not subtotal, even though they happen to agree
    // numerically here). Pins the formula, not the coincidence.
    const { service, prisma } = await makeService()
    prisma.order.findFirst.mockResolvedValue(
      makeOrder({
        subtotal: 100,
        discountAmount: 0,
        shippingCost: 0,
        taxAmount: 15.97,
        totalAmount: 100,
      }),
    )

    await service.generateAndStoreInvoice('order-1')

    const created = prisma.invoice.create.mock.calls[0][0].data
    expect(created.grossAmount).toBe(100)
    expect(created.taxAmount).toBe(15.97)
    expect(created.netAmount).toBe(84.03)
    expect(Math.abs(created.netAmount + created.taxAmount - created.grossAmount)).toBeLessThanOrEqual(0.01)
  })

  it('#3 Free-shipping coupon: shipping=0 does not distort net', async () => {
    // Free-shipping keeps shipping=0; the rest of the math is identical.
    // Ensures the free-shipping flag doesn't accidentally flow into an
    // alternative net-calc branch.
    const { service, prisma } = await makeService()
    prisma.order.findFirst.mockResolvedValue(
      makeOrder({
        subtotal: 200,
        discountAmount: 0,
        shippingCost: 0,  // free-shipping applied
        taxAmount: 31.93,
        totalAmount: 200,
        couponCode: 'FREESHIP',
      }),
    )

    await service.generateAndStoreInvoice('order-1')

    const created = prisma.invoice.create.mock.calls[0][0].data
    expect(created.grossAmount).toBe(200)
    expect(created.taxAmount).toBe(31.93)
    expect(created.netAmount).toBe(168.07)
  })

  it('#4 Money-safe rounding: floating drift stays within 1 cent', async () => {
    // Pick numbers that produce float arithmetic with rounding edge
    // cases so we verify toFixed(2) is actually applied.
    // gross 29.95, tax 4.78 → raw net = 25.170000000...0001
    // Must round to 25.17, not 25.169999999.
    const { service, prisma } = await makeService()
    prisma.order.findFirst.mockResolvedValue(
      makeOrder({
        subtotal: 29.95,
        discountAmount: 0,
        shippingCost: 0,
        taxAmount: 4.78,
        totalAmount: 29.95,
      }),
    )

    await service.generateAndStoreInvoice('order-1')

    const created = prisma.invoice.create.mock.calls[0][0].data
    expect(created.netAmount).toBe(25.17)
    // Not a floating-dirty value like 25.169999999999998
    expect(Number.isInteger(created.netAmount * 100)).toBe(true)
  })
})
