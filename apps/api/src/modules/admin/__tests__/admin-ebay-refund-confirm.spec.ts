/**
 * AdminReturnsService.manualConfirmEbayRefund (C13.3) unit tests.
 *
 * Pins down:
 *   - Happy path: PENDING eBay refund → flipped PROCESSED + processedAt + audit
 *   - Non-eBay provider (Vorkasse/Stripe/etc.) → 400 OnlyEbayManagedPaymentsSupported
 *   - Already-PROCESSED refund → 400 RefundNotPending
 *   - Already-FAILED refund → 400 RefundNotPending
 *   - Refund-not-found → 404 RefundNotFound
 *   - Audit-log written with admin-id + IP
 */

import { BadRequestException, NotFoundException } from '@nestjs/common'
import { AdminReturnsService } from '../services/admin-returns.service'

type AnyJest = jest.Mock<any, any>

function makeService() {
  const prisma = {
    refund: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({ processedAt: new Date() }),
    },
  } as any
  const paymentsService = {} as any
  const notificationService = {} as any
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as any
  const emailService = {} as any
  const eventEmitter = {} as any
  const dhlProvider = {} as any
  const service = new AdminReturnsService(
    prisma, paymentsService, notificationService, audit, emailService, eventEmitter, dhlProvider,
  )
  return { service, prisma, audit }
}

function makeRefund(overrides: any = {}) {
  return {
    id: 'ref-eb-1',
    status: 'PENDING',
    amount: 29.99,
    processedAt: null,
    providerRefundId: 'ebay-r-1',
    payment: {
      provider: 'EBAY_MANAGED_PAYMENTS',
      orderId: 'o1',
      order: { orderNumber: 'ORD-MP-001' },
    },
    ...overrides,
  }
}

// ──────────────────────────────────────────────────────────────
// Happy path
// ──────────────────────────────────────────────────────────────

describe('AdminReturnsService.manualConfirmEbayRefund — happy path', () => {
  it('PENDING eBay refund → PROCESSED + processedAt + audit', async () => {
    const { service, prisma, audit } = makeService()
    ;(prisma.refund.findUnique as AnyJest).mockResolvedValue(makeRefund())

    await service.manualConfirmEbayRefund('ref-eb-1', 'admin-uuid-1', '127.0.0.1')

    expect(prisma.refund.update).toHaveBeenCalledWith({
      where: { id: 'ref-eb-1' },
      data: { status: 'PROCESSED', processedAt: expect.any(Date) },
    })
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'admin-uuid-1',
        action: 'EBAY_REFUND_MANUALLY_CONFIRMED',
        entityType: 'refund',
        entityId: 'ref-eb-1',
        ipAddress: '127.0.0.1',
      }),
    )
    const auditCall = (audit.log as AnyJest).mock.calls[0][0]
    expect(auditCall.changes.before).toEqual({ status: 'PENDING', processedAt: null })
    expect(auditCall.changes.after).toMatchObject({
      status: 'PROCESSED',
      amount: 29.99,
      providerRefundId: 'ebay-r-1',
      orderNumber: 'ORD-MP-001',
    })
  })
})

// ──────────────────────────────────────────────────────────────
// Guards (non-eBay, not-pending, not-found)
// ──────────────────────────────────────────────────────────────

describe('AdminReturnsService.manualConfirmEbayRefund — guards', () => {
  it('refund not found → 404', async () => {
    const { service, prisma } = makeService()
    ;(prisma.refund.findUnique as AnyJest).mockResolvedValue(null)
    await expect(
      service.manualConfirmEbayRefund('nope', 'admin', 'ip'),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.refund.update).not.toHaveBeenCalled()
  })

  it.each([
    ['STRIPE'],
    ['PAYPAL'],
    ['KLARNA'],
    ['SUMUP'],
    ['VORKASSE'],
  ])('non-eBay provider %p → 400 OnlyEbayManagedPaymentsSupported', async (provider) => {
    const { service, prisma } = makeService()
    ;(prisma.refund.findUnique as AnyJest).mockResolvedValue(
      makeRefund({ payment: { ...makeRefund().payment, provider } }),
    )
    const err = await service
      .manualConfirmEbayRefund('ref-eb-1', 'admin', 'ip')
      .catch((e) => e)
    expect(err).toBeInstanceOf(BadRequestException)
    expect(err.getResponse?.()?.error ?? err.response?.error).toBe('OnlyEbayManagedPaymentsSupported')
    expect(prisma.refund.update).not.toHaveBeenCalled()
  })

  it.each([
    ['PROCESSED'],
    ['FAILED'],
  ])('already-%p refund → 400 RefundNotPending', async (status) => {
    const { service, prisma } = makeService()
    ;(prisma.refund.findUnique as AnyJest).mockResolvedValue(
      makeRefund({ status }),
    )
    const err = await service
      .manualConfirmEbayRefund('ref-eb-1', 'admin', 'ip')
      .catch((e) => e)
    expect(err).toBeInstanceOf(BadRequestException)
    expect(err.getResponse?.()?.error ?? err.response?.error).toBe('RefundNotPending')
    expect(prisma.refund.update).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────
// Idempotency (parallel-call safety)
// ──────────────────────────────────────────────────────────────

describe('AdminReturnsService.manualConfirmEbayRefund — idempotency', () => {
  it('second call after PROCESSED → 400 RefundNotPending (no double-flip)', async () => {
    const { service, prisma } = makeService()
    // Simulate: first call already happened; refund is now PROCESSED
    ;(prisma.refund.findUnique as AnyJest).mockResolvedValue(
      makeRefund({ status: 'PROCESSED', processedAt: new Date() }),
    )
    const err = await service
      .manualConfirmEbayRefund('ref-eb-1', 'admin-2', 'ip')
      .catch((e) => e)
    expect(err).toBeInstanceOf(BadRequestException)
    expect(prisma.refund.update).not.toHaveBeenCalled()
  })
})
