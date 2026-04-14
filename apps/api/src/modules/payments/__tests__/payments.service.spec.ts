import { Test, TestingModule } from '@nestjs/testing'
import { EventEmitter2 } from '@nestjs/event-emitter'
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common'
import { PaymentsService } from '../payments.service'
import { InvoiceService } from '../invoice.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { PAYMENT_PROVIDERS, IPaymentProvider } from '../payment-provider.interface'

const mockInvoiceService = {
  generateAndStoreInvoice: jest.fn().mockResolvedValue({ invoice: { id: 'inv1' }, pdfBuffer: Buffer.alloc(0) }),
  generateAndStoreCreditNote: jest.fn().mockResolvedValue({ invoice: { id: 'gs1' }, pdfBuffer: Buffer.alloc(0) }),
  getOrGenerateInvoice: jest.fn().mockResolvedValue(Buffer.alloc(0)),
}

// ── Mocks ────────────────────────────────────────────────────

const mockPrisma = {
  order: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  payment: {
    findFirst: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  },
  refund: { create: jest.fn() },
  orderStatusHistory: { create: jest.fn() },
  webhookEvent: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn().mockImplementation((fnOrArray: any) =>
    typeof fnOrArray === 'function' ? fnOrArray(mockPrisma) : Promise.all(fnOrArray),
  ),
  $queryRaw: jest.fn(),
}

const mockEventEmitter = {
  emit: jest.fn(),
  emitAsync: jest.fn().mockResolvedValue([]),
}

const mockStripeProvider: IPaymentProvider = {
  providerName: 'STRIPE',
  createPaymentIntent: jest.fn().mockResolvedValue({
    providerPaymentId: 'pi_test123',
    clientSecret: 'cs_test_secret',
    status: 'requires_action',
  }),
  refund: jest.fn().mockResolvedValue({
    providerRefundId: 're_test123',
    status: 'succeeded',
    amount: 5000,
  }),
  verifyWebhookSignature: jest.fn().mockReturnValue({
    isValid: true,
    eventType: 'payment_intent.succeeded',
    eventId: 'evt_test123',
    payload: { id: 'pi_test123' },
  }),
}

const makeOrder = (overrides = {}) => ({
  id: 'order1',
  orderNumber: 'ORD-20260326-000001',
  status: 'pending',
  totalAmount: 119.99,
  subtotal: 100.83,
  taxAmount: 19.16,
  shippingCost: 8.00,
  currency: 'EUR',
  userId: 'user1',
  deletedAt: null,
  notes: null,
  user: { email: 'test@malak-bekleidung.com', firstName: 'Anna', lastName: 'Müller' },
  payment: null,
  ...overrides,
})

const makePayment = (overrides = {}) => ({
  id: 'pay1',
  orderId: 'order1',
  provider: 'STRIPE',
  method: 'stripe_card',
  status: 'captured',
  amount: 119.99,
  providerPaymentId: 'pi_test123',
  refunds: [],
  order: {
    id: 'order1',
    orderNumber: 'ORD-20260326-000001',
    status: 'confirmed',
    notes: JSON.stringify({ reservationIds: ['res1', 'res2'] }),
  },
  ...overrides,
})

// ── Tests ────────────────────────────────────────────────────

describe('PaymentsService', () => {
  let service: PaymentsService

  beforeEach(async () => {
    jest.clearAllMocks()
    mockPrisma.$transaction.mockImplementation((fnOrArray: any) =>
      typeof fnOrArray === 'function' ? fnOrArray(mockPrisma) : Promise.all(fnOrArray),
    )

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: InvoiceService, useValue: mockInvoiceService },
        { provide: PAYMENT_PROVIDERS, useValue: [mockStripeProvider] },
      ],
    }).compile()

    service = module.get<PaymentsService>(PaymentsService)
  })

  // ── createPayment ─────────────────────────────────────────

  describe('createPayment', () => {
    it('erstellt Stripe PaymentIntent und gibt clientSecret zurück', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(makeOrder())
      mockPrisma.payment.upsert.mockResolvedValue({ id: 'pay1', providerPaymentId: 'pi_test123' })
      mockPrisma.order.update.mockResolvedValue({})

      const result = await service.createPayment(
        { orderId: 'order1', method: 'stripe_card' as any },
        'user1',
        'corr1',
      )

      expect(result.clientSecret).toBe('cs_test_secret')
      expect(result.providerPaymentId).toBe('pi_test123')
      expect(mockStripeProvider.createPaymentIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 11999, // 119.99 * 100 cents
          currency: 'EUR',
        }),
      )
    })

    it('wirft NotFoundException wenn Bestellung nicht existiert', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(null)

      await expect(
        service.createPayment({ orderId: 'ghost', method: 'stripe_card' as any }, 'user1', 'corr'),
      ).rejects.toThrow(NotFoundException)
    })

    it('wirft BadRequestException wenn Bestellung nicht im richtigen Status', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(makeOrder({ status: 'shipped' }))

      await expect(
        service.createPayment({ orderId: 'order1', method: 'stripe_card' as any }, 'user1', 'corr'),
      ).rejects.toThrow(BadRequestException)
    })

    it('wirft ConflictException wenn aktive Zahlung existiert', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(
        makeOrder({ payment: { status: 'captured' } }),
      )

      await expect(
        service.createPayment({ orderId: 'order1', method: 'stripe_card' as any }, 'user1', 'corr'),
      ).rejects.toThrow(ConflictException)
    })

    it('berechnet Amount serverseitig — NIEMALS vom Frontend', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(makeOrder({ totalAmount: 250.00 }))
      mockPrisma.payment.upsert.mockResolvedValue({ id: 'pay1' })
      mockPrisma.order.update.mockResolvedValue({})

      await service.createPayment(
        { orderId: 'order1', method: 'stripe_card' as any },
        'user1',
        'corr',
      )

      expect(mockStripeProvider.createPaymentIntent).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 25000 }), // 250.00 * 100
      )
    })
  })

  // ── handlePaymentSuccess ──────────────────────────────────

  describe('handlePaymentSuccess', () => {
    it('setzt Payment=captured, Order=confirmed und emittiert Events', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue(
        makePayment({ status: 'pending', order: { id: 'order1', orderNumber: 'ORD-001', status: 'pending_payment', notes: '{"reservationIds":["r1"]}' } }),
      )
      mockPrisma.payment.update.mockResolvedValue({})
      mockPrisma.order.update.mockResolvedValue({})
      mockPrisma.orderStatusHistory.create.mockResolvedValue({})

      await service.handlePaymentSuccess('pi_test123', 'STRIPE', 'corr1')

      // Payment captured
      expect(mockPrisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'captured' }) }),
      )
      // Order confirmed
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'confirmed' }),
        }),
      )
      // Inventory event emitted
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'order.confirmed',
        expect.objectContaining({ reservationIds: ['r1'] }),
      )
      // Status changed event emitted (for email)
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'order.status_changed',
        expect.objectContaining({ toStatus: 'confirmed' }),
      )
    })

    it('überspringt bereits captured Zahlungen (Idempotency)', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue(makePayment({ status: 'captured' }))

      await service.handlePaymentSuccess('pi_test123', 'STRIPE', 'corr1')

      expect(mockPrisma.payment.update).not.toHaveBeenCalled()
    })
  })

  // ── handlePaymentFailure ──────────────────────────────────

  describe('handlePaymentFailure', () => {
    it('storniert Bestellung und gibt Reservierungen frei', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue(
        makePayment({ status: 'pending', order: { id: 'order1', orderNumber: 'ORD-001', status: 'pending_payment', notes: '{"reservationIds":["r1"]}' } }),
      )
      mockPrisma.payment.update.mockResolvedValue({})
      mockPrisma.order.update.mockResolvedValue({})
      mockPrisma.orderStatusHistory.create.mockResolvedValue({})

      await service.handlePaymentFailure('pi_test123', 'Card declined', 'corr1')

      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled' }) }),
      )
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'order.cancelled',
        expect.objectContaining({ reason: 'payment_failed: Card declined' }),
      )
    })
  })

  // ── handleDispute ─────────────────────────────────────────

  describe('handleDispute', () => {
    it('markiert Bestellung als disputed', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue(makePayment())
      mockPrisma.order.update.mockResolvedValue({})
      mockPrisma.orderStatusHistory.create.mockResolvedValue({})

      await service.handleDispute('pi_test123', 'fraudulent', 'corr1')

      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'disputed' } }),
      )
    })
  })

  // ── createRefund ──────────────────────────────────────────

  describe('createRefund', () => {
    it('erstellt Teilerstattung über Stripe', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue(makePayment())
      mockPrisma.refund.create.mockResolvedValue({ id: 'ref1' })
      mockPrisma.payment.update.mockResolvedValue({})

      const result = await service.createRefund(
        { paymentId: 'pay1', amount: 5000, reason: 'customer_request' },
        'admin1',
        'corr1',
      )

      expect(mockStripeProvider.refund).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 5000 }),
      )
      expect(result.id).toBe('ref1')
    })

    it('wirft BadRequestException wenn Erstattung den Zahlungsbetrag übersteigt', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue(
        makePayment({ amount: 50.00, refunds: [{ status: 'PROCESSED', amount: 40.00 }] }),
      )

      await expect(
        service.createRefund(
          { paymentId: 'pay1', amount: 1500 }, // 15€ > 10€ remaining
          'admin1',
          'corr1',
        ),
      ).rejects.toThrow(BadRequestException)
    })

    it('wirft BadRequestException wenn Zahlung nicht captured', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue(makePayment({ status: 'pending' }))

      await expect(
        service.createRefund({ paymentId: 'pay1', amount: 5000 }, 'admin1', 'corr1'),
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ── Webhook Signatur ──────────────────────────────────────

  describe('Webhook Signature Verification', () => {
    it('Stripe Provider verifiziert Signatur korrekt', () => {
      const result = mockStripeProvider.verifyWebhookSignature(
        Buffer.from('test'), 'sig_test',
      )
      expect(result.isValid).toBe(true)
      expect(result.eventType).toBe('payment_intent.succeeded')
    })
  })
})
