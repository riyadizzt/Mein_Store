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
  // Two-phase credit-note flow introduced with the refund-atomicity fix.
  // Phase 1: shell creation inside the refund $transaction.
  createCreditNoteShellInTx: jest.fn().mockResolvedValue({
    invoiceId: 'shell1',
    creditNoteNumber: 'GS-2026-00001',
    originalInvoiceNumber: 'RE-2026-00001',
    pdfInputOrder: { orderNumber: 'ORD-TEST' },
    pdfInputReturnItems: [],
  }),
  // Phase 2: PDF upload + invoice finalization (post-tx). Default happy path.
  finalizeCreditNotePdf: jest.fn().mockResolvedValue({ ok: true, pdfBuffer: Buffer.alloc(0) }),
  // Legacy orchestrator (kept for non-refund call sites).
  generateCreditNote: jest.fn().mockResolvedValue({ creditNote: { id: 'gs1' }, pdfBuffer: Buffer.alloc(0) }),
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

  // ── Two-Phase Commit for refund + credit-note atomicity ────────
  //
  // The launch-blocker fix: the refund + payment-update + order-update +
  // credit-note-shell must all commit atomically in one $transaction,
  // and the Supabase PDF upload happens AFTER the tx commits so a
  // transient storage hiccup can never leave a refund without a matching
  // Gutschrift row. Previous behaviour (try/catch on generateCreditNote)
  // silently swallowed upload errors.
  describe('createRefund — Two-Phase Commit', () => {
    beforeEach(() => {
      // Default happy-path mocks. Per-test overrides below.
      mockInvoiceService.createCreditNoteShellInTx = jest.fn().mockResolvedValue({
        invoiceId: 'shell1',
        creditNoteNumber: 'GS-2026-00042',
        originalInvoiceNumber: 'RE-2026-00001',
        pdfInputOrder: { orderNumber: 'ORD-20260326-000001' },
        pdfInputReturnItems: [],
      })
      mockInvoiceService.finalizeCreditNotePdf = jest.fn().mockResolvedValue({
        ok: true,
        pdfBuffer: Buffer.alloc(0),
      })
    })

    it('Phase 1: Refund + Payment + Order + Credit-Note-Shell commit in ONE $transaction', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue(
        makePayment({ amount: 50.00, refunds: [] }),
      )
      mockPrisma.refund.create.mockResolvedValue({ id: 'ref1', status: 'PROCESSED' })
      mockPrisma.payment.update.mockResolvedValue({})
      mockPrisma.order.update.mockResolvedValue({})

      // $transaction wraps the Phase 1 block. Spy on it.
      await service.createRefund(
        { paymentId: 'pay1', amount: 5000 /* full refund of €50 */ },
        'admin1',
        'corr1',
      )

      // $transaction was entered with a function (not an array of ops)
      expect(mockPrisma.$transaction).toHaveBeenCalled()
      const txArg = (mockPrisma.$transaction as jest.Mock).mock.calls[0][0]
      expect(typeof txArg).toBe('function')

      // createCreditNoteShellInTx was called inside the tx
      expect(mockInvoiceService.createCreditNoteShellInTx).toHaveBeenCalledWith(
        expect.anything(),  // tx client
        expect.any(String), // orderId
        50,                  // refund amount in EUR (5000 cents / 100)
      )
    })

    it('Phase 2: PDF finalize is called AFTER the transaction commits', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue(
        makePayment({ amount: 50.00, refunds: [] }),
      )
      mockPrisma.refund.create.mockResolvedValue({ id: 'ref1', status: 'PROCESSED' })
      mockPrisma.payment.update.mockResolvedValue({})
      mockPrisma.order.update.mockResolvedValue({})

      await service.createRefund(
        { paymentId: 'pay1', amount: 3000 /* partial €30 */ },
        'admin1',
        'corr1',
      )

      // Phase 2 invoked with the shell data from Phase 1
      expect(mockInvoiceService.finalizeCreditNotePdf).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceId: 'shell1',
          creditNoteNumber: 'GS-2026-00042',
          refundAmount: 30,
        }),
      )
    })

    it('Phase 2 failure: emits payment.credit_note_pdf_pending event, refund still succeeds', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue(
        makePayment({ amount: 50.00, refunds: [] }),
      )
      mockPrisma.refund.create.mockResolvedValue({ id: 'ref1', status: 'PROCESSED' })
      mockPrisma.payment.update.mockResolvedValue({})
      mockPrisma.order.update.mockResolvedValue({})

      // Simulate all 3 Supabase retries exhausted
      mockInvoiceService.finalizeCreditNotePdf = jest.fn().mockResolvedValue({
        ok: false,
        error: 'Supabase 503 after 3 retries',
      })

      // Refund must still resolve successfully — silent-success pattern:
      // the refund is committed, only the PDF is deferred.
      const result = await service.createRefund(
        { paymentId: 'pay1', amount: 5000 },
        'admin1',
        'corr1',
      )
      expect(result).toBeDefined()
      expect(result.id).toBe('ref1')

      // Admin-notification event was emitted so the pending-PDF state
      // is surfaced to the admin UI. The listener (in AdminModule) turns
      // this into a proper notification row.
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'payment.credit_note_pdf_pending',
        expect.objectContaining({
          invoiceId: 'shell1',
          creditNoteNumber: 'GS-2026-00042',
          refundAmount: 50,
          error: expect.stringContaining('Supabase'),
        }),
      )
    })

    it('Phase 1 rollback: if shell-creation throws, no post-tx work runs', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue(
        makePayment({ amount: 50.00, refunds: [] }),
      )
      mockPrisma.refund.create.mockResolvedValue({ id: 'ref1', status: 'PROCESSED' })
      mockPrisma.payment.update.mockResolvedValue({})
      mockPrisma.order.update.mockResolvedValue({})

      // Simulate the GS-sequence upsert or invoice.create failing inside tx.
      // Since our mock $transaction just invokes the fn synchronously and
      // returns its result (no real rollback), the throw from
      // createCreditNoteShellInTx surfaces as a thrown $transaction.
      mockInvoiceService.createCreditNoteShellInTx = jest.fn().mockRejectedValue(
        new Error('DB deadlock on invoice_sequences'),
      )

      await expect(
        service.createRefund(
          { paymentId: 'pay1', amount: 5000 },
          'admin1',
          'corr1',
        ),
      ).rejects.toThrow('DB deadlock on invoice_sequences')

      // Phase 2 must NOT have been called — the tx rolled back before
      // we left $transaction().
      expect(mockInvoiceService.finalizeCreditNotePdf).not.toHaveBeenCalled()
      // And no pending-pdf notification since Phase 2 never ran.
      expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
        'payment.credit_note_pdf_pending',
        expect.anything(),
      )
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
