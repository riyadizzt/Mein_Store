/**
 * Tests for PaymentsService.abortPendingOrder
 *
 * Covers the new "user clicks Cancel at PayPal" flow:
 *   - Pending orders are cancelled and stock reservations released
 *   - Already-paid orders are NOT touched (idempotent / safe)
 *   - Already-cancelled orders are NOT touched
 *   - Missing orders return cleanly
 *   - Malformed notes don't crash the abort
 */

import { Test, TestingModule } from '@nestjs/testing'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { PaymentsService } from '../payments.service'
import { InvoiceService } from '../invoice.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { PAYMENT_PROVIDERS, IPaymentProvider } from '../payment-provider.interface'

const mockStripeProvider: IPaymentProvider = {
  providerName: 'STRIPE',
  createPaymentIntent: jest.fn(),
  refund: jest.fn(),
  verifyWebhookSignature: jest.fn(),
}

const mockInvoiceService = {
  generateAndStoreInvoice: jest.fn(),
  generateAndStoreCreditNote: jest.fn(),
}

function buildPrisma() {
  const mock: any = {
    order: { findUnique: jest.fn(), update: jest.fn() },
    payment: { update: jest.fn() },
    orderStatusHistory: { create: jest.fn() },
  }
  mock.$transaction = jest.fn().mockImplementation((fn: any) =>
    typeof fn === 'function' ? fn(mock) : Promise.all(fn),
  )
  return mock
}

async function makeService(prisma: any, eventEmitter: { emit: jest.Mock }) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PaymentsService,
      { provide: PrismaService, useValue: prisma },
      { provide: EventEmitter2, useValue: eventEmitter },
      { provide: InvoiceService, useValue: mockInvoiceService },
      { provide: PAYMENT_PROVIDERS, useValue: [mockStripeProvider] },
    ],
  }).compile()
  return module.get<PaymentsService>(PaymentsService)
}

describe('PaymentsService.abortPendingOrder', () => {
  let prisma: any
  let eventEmitter: { emit: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = buildPrisma()
    eventEmitter = { emit: jest.fn() }
  })

  describe('Happy path', () => {
    it('aborts a pending_payment order and releases reservations', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order1',
        orderNumber: 'ORD-2026-00001',
        status: 'pending_payment',
        notes: JSON.stringify({ reservationIds: ['res-A', 'res-B'] }),
        payment: { status: 'pending' },
      })

      const service = await makeService(prisma, eventEmitter)
      const result = await service.abortPendingOrder('order1')

      expect(result).toEqual({ aborted: true, orderNumber: 'ORD-2026-00001' })

      // Order updated to cancelled
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order1' },
          data: expect.objectContaining({
            status: 'cancelled',
            cancelReason: 'User aborted payment at gateway',
          }),
        }),
      )

      // Payment marked as failed
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orderId: 'order1' },
          data: expect.objectContaining({ status: 'failed' }),
        }),
      )

      // Status history entry created
      expect(prisma.orderStatusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: 'order1',
            toStatus: 'cancelled',
            source: 'user_abort',
          }),
        }),
      )

      // Stock reservations released via event
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'order.cancelled',
        expect.objectContaining({
          orderId: 'order1',
          reservationIds: ['res-A', 'res-B'],
          reason: 'user_abort',
        }),
      )
    })

    it('also aborts an order in plain "pending" status', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order2',
        orderNumber: 'ORD-2026-00002',
        status: 'pending',
        notes: null,
        payment: null,
      })

      const service = await makeService(prisma, eventEmitter)
      const result = await service.abortPendingOrder('order2')

      expect(result.aborted).toBe(true)
      expect(prisma.order.update).toHaveBeenCalled()
    })
  })

  describe('Idempotency / safety guards', () => {
    it('does NOT touch an already-cancelled order', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order3',
        orderNumber: 'ORD-2026-00003',
        status: 'cancelled',
        notes: null,
        payment: { status: 'failed' },
      })

      const service = await makeService(prisma, eventEmitter)
      const result = await service.abortPendingOrder('order3')

      expect(result.aborted).toBe(false)
      expect(result.reason).toBe('order_status_cancelled')
      expect(prisma.order.update).not.toHaveBeenCalled()
      expect(prisma.payment.update).not.toHaveBeenCalled()
      expect(eventEmitter.emit).not.toHaveBeenCalled()
    })

    it('does NOT touch a confirmed (paid) order', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order4',
        orderNumber: 'ORD-2026-00004',
        status: 'confirmed',
        notes: null,
        payment: { status: 'captured' },
      })

      const service = await makeService(prisma, eventEmitter)
      const result = await service.abortPendingOrder('order4')

      expect(result.aborted).toBe(false)
      expect(prisma.order.update).not.toHaveBeenCalled()
    })

    it('does NOT touch a pending order whose payment is already captured (race condition)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order5',
        orderNumber: 'ORD-2026-00005',
        status: 'pending_payment',
        notes: null,
        payment: { status: 'captured' }, // money is in!
      })

      const service = await makeService(prisma, eventEmitter)
      const result = await service.abortPendingOrder('order5')

      expect(result.aborted).toBe(false)
      expect(result.reason).toBe('already_paid')
      expect(prisma.order.update).not.toHaveBeenCalled()
    })

    it('does NOT touch a pending order with authorized payment', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order6',
        orderNumber: 'ORD-2026-00006',
        status: 'pending_payment',
        notes: null,
        payment: { status: 'authorized' },
      })

      const service = await makeService(prisma, eventEmitter)
      const result = await service.abortPendingOrder('order6')

      expect(result.aborted).toBe(false)
      expect(result.reason).toBe('already_paid')
    })

    it('returns aborted:false for a non-existent order (no exception)', async () => {
      prisma.order.findUnique.mockResolvedValue(null)

      const service = await makeService(prisma, eventEmitter)
      const result = await service.abortPendingOrder('ghost-id')

      expect(result).toEqual({ aborted: false, reason: 'not_found' })
    })

    it('does not touch a shipped order', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order7',
        orderNumber: 'ORD-2026-00007',
        status: 'shipped',
        notes: null,
        payment: { status: 'captured' },
      })

      const service = await makeService(prisma, eventEmitter)
      const result = await service.abortPendingOrder('order7')

      expect(result.aborted).toBe(false)
      expect(result.reason).toBe('order_status_shipped')
    })
  })

  describe('Robustness', () => {
    it('tolerates malformed notes JSON without crashing (Bug-1 regression)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order8',
        orderNumber: 'ORD-2026-00008',
        status: 'pending_payment',
        notes: '{not valid json',
        payment: { status: 'pending' },
      })

      const service = await makeService(prisma, eventEmitter)
      // Should NOT throw despite malformed JSON
      await expect(service.abortPendingOrder('order8')).resolves.toEqual({
        aborted: true,
        orderNumber: 'ORD-2026-00008',
      })

      // No reservation event since notes was garbage → empty array
      const reservationCalls = eventEmitter.emit.mock.calls.filter(
        (c) => c[0] === 'order.cancelled',
      )
      expect(reservationCalls).toHaveLength(0)
    })

    it('handles order without a payment row (e.g. abandoned before payment created)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order9',
        orderNumber: 'ORD-2026-00009',
        status: 'pending_payment',
        notes: null,
        payment: null,
      })

      const service = await makeService(prisma, eventEmitter)
      const result = await service.abortPendingOrder('order9')

      expect(result.aborted).toBe(true)
      // payment.update should NOT be called when there is no payment row
      expect(prisma.payment.update).not.toHaveBeenCalled()
    })

    it('handles missing notes (null) without trying to parse', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order10',
        orderNumber: 'ORD-2026-00010',
        status: 'pending_payment',
        notes: null,
        payment: { status: 'pending' },
      })

      const service = await makeService(prisma, eventEmitter)
      const result = await service.abortPendingOrder('order10')

      expect(result.aborted).toBe(true)
      // No reservation event
      expect(eventEmitter.emit).not.toHaveBeenCalled()
    })

    it('emits exactly one cancellation event per abort', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order11',
        orderNumber: 'ORD-2026-00011',
        status: 'pending_payment',
        notes: JSON.stringify({ reservationIds: ['r1'] }),
        payment: { status: 'pending' },
      })

      const service = await makeService(prisma, eventEmitter)
      await service.abortPendingOrder('order11')

      expect(eventEmitter.emit).toHaveBeenCalledTimes(1)
    })
  })
})
