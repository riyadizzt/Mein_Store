/**
 * Tests for method-switch safety (Step 2 of the Reuse-Pending-Order work).
 *
 * Guards the contract:
 *   - createPayment() pushes the old providerPaymentId into
 *     previousProviderPaymentIds when replacing an existing pending/failed
 *     intent.
 *   - createPayment() calls cancelPaymentIntent on the OLD provider when
 *     switching away — best-effort, failures must not block the new payment.
 *   - Webhook handlers (success/failure/dispute) fall back to the previous
 *     IDs array when the direct lookup misses, so a late-firing intent on an
 *     abandoned attempt still reaches the right payment row.
 *   - Fallback capture rewrites provider + providerPaymentId so future
 *     refunds hit the account that actually charged.
 *   - Fallback failure/dispute do NOT corrupt order state (the active intent
 *     may still be running).
 */

import { Test, TestingModule } from '@nestjs/testing'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { PaymentsService } from '../payments.service'
import { InvoiceService } from '../invoice.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { PAYMENT_PROVIDERS, IPaymentProvider } from '../payment-provider.interface'

const mockInvoiceService = {
  generateAndStoreInvoice: jest
    .fn()
    .mockResolvedValue({ invoice: { id: 'inv1', invoiceNumber: 'RE-2026-00001', grossAmount: 100 }, pdfBuffer: Buffer.alloc(0) }),
  generateCreditNote: jest.fn().mockResolvedValue({ id: 'cn1' }),
}

const mockStripe: IPaymentProvider & { cancelPaymentIntent: jest.Mock } = {
  providerName: 'STRIPE',
  createPaymentIntent: jest.fn(),
  refund: jest.fn(),
  verifyWebhookSignature: jest.fn(),
  cancelPaymentIntent: jest.fn().mockResolvedValue(undefined),
}

const mockPaypal: IPaymentProvider = {
  providerName: 'PAYPAL',
  createPaymentIntent: jest.fn(),
  refund: jest.fn(),
  verifyWebhookSignature: jest.fn(),
  // No cancelPaymentIntent — relies on fallback path
}

function buildPrisma() {
  const mock: any = {
    order: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    payment: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    orderStatusHistory: { create: jest.fn() },
  }
  mock.$transaction = jest
    .fn()
    .mockImplementation((fn: any) => (typeof fn === 'function' ? fn(mock) : Promise.all(fn)))
  return mock
}

async function makeService(prisma: any) {
  const eventEmitter = { emit: jest.fn(), emitAsync: jest.fn() }
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PaymentsService,
      { provide: PrismaService, useValue: prisma },
      { provide: EventEmitter2, useValue: eventEmitter },
      { provide: InvoiceService, useValue: mockInvoiceService },
      { provide: PAYMENT_PROVIDERS, useValue: [mockStripe, mockPaypal] },
    ],
  }).compile()
  return { service: module.get<PaymentsService>(PaymentsService), eventEmitter }
}

const pendingOrderRow = (overrides: any = {}) => ({
  id: 'order1',
  orderNumber: 'ORD-2026-00001',
  status: 'pending_payment',
  totalAmount: 100,
  currency: 'EUR',
  userId: 'user1',
  guestEmail: null,
  user: { email: 'a@b.de', firstName: 'A', lastName: 'B' },
  payment: null,
  ...overrides,
})

beforeEach(() => {
  jest.clearAllMocks()
})

describe('PaymentsService — createPayment method-switch safety', () => {
  it('pushes the old Stripe intent into previousProviderPaymentIds when switching to PayPal', async () => {
    const prisma = buildPrisma()
    prisma.order.findFirst.mockResolvedValue(
      pendingOrderRow({
        payment: {
          id: 'pay1',
          status: 'pending',
          provider: 'STRIPE',
          providerPaymentId: 'pi_OLD_111',
          previousProviderPaymentIds: [],
        },
      }),
    )
    prisma.payment.upsert.mockResolvedValue({ id: 'pay1' })
    ;(mockPaypal.createPaymentIntent as jest.Mock).mockResolvedValue({
      providerPaymentId: 'pp_NEW_222',
      clientSecret: null,
      status: 'pending',
      redirectUrl: 'https://paypal.example/checkout',
    })

    const { service } = await makeService(prisma)
    await service.createPayment({ orderId: 'order1', method: 'paypal' } as any, 'user1', 'corr1')

    const upsertArgs = prisma.payment.upsert.mock.calls[0][0]
    expect(upsertArgs.update.providerPaymentId).toBe('pp_NEW_222')
    expect(upsertArgs.update.previousProviderPaymentIds).toContain('pi_OLD_111')
    expect(upsertArgs.update.provider).toBe('PAYPAL')
  })

  it('calls cancelPaymentIntent on the OLD Stripe intent when switching away from Stripe', async () => {
    const prisma = buildPrisma()
    prisma.order.findFirst.mockResolvedValue(
      pendingOrderRow({
        payment: {
          id: 'pay1',
          status: 'pending',
          provider: 'STRIPE',
          providerPaymentId: 'pi_OLD_111',
          previousProviderPaymentIds: [],
        },
      }),
    )
    prisma.payment.upsert.mockResolvedValue({ id: 'pay1' })
    ;(mockPaypal.createPaymentIntent as jest.Mock).mockResolvedValue({
      providerPaymentId: 'pp_NEW_222',
      clientSecret: null,
      status: 'pending',
    })

    const { service } = await makeService(prisma)
    await service.createPayment({ orderId: 'order1', method: 'paypal' } as any, 'user1', 'corr1')

    expect(mockStripe.cancelPaymentIntent).toHaveBeenCalledWith('pi_OLD_111')
  })

  it('best-effort cancel: a cancel failure on the old provider does NOT block the new payment', async () => {
    const prisma = buildPrisma()
    prisma.order.findFirst.mockResolvedValue(
      pendingOrderRow({
        payment: {
          id: 'pay1',
          status: 'pending',
          provider: 'STRIPE',
          providerPaymentId: 'pi_OLD_111',
          previousProviderPaymentIds: [],
        },
      }),
    )
    prisma.payment.upsert.mockResolvedValue({ id: 'pay1' })
    ;(mockStripe.cancelPaymentIntent as jest.Mock).mockRejectedValueOnce(
      new Error('intent already cancelled'),
    )
    ;(mockPaypal.createPaymentIntent as jest.Mock).mockResolvedValue({
      providerPaymentId: 'pp_NEW_222',
      clientSecret: null,
      status: 'pending',
    })

    const { service } = await makeService(prisma)
    await expect(
      service.createPayment({ orderId: 'order1', method: 'paypal' } as any, 'user1', 'corr1'),
    ).resolves.toBeDefined()

    // The old ID still landed in the fallback array (that is the actual safety net)
    const upsertArgs = prisma.payment.upsert.mock.calls[0][0]
    expect(upsertArgs.update.previousProviderPaymentIds).toContain('pi_OLD_111')
  })

  it('does NOT try to cancel when switching TO a provider that lacks cancelPaymentIntent (PayPal→Stripe)', async () => {
    const prisma = buildPrisma()
    prisma.order.findFirst.mockResolvedValue(
      pendingOrderRow({
        payment: {
          id: 'pay1',
          status: 'pending',
          provider: 'PAYPAL',
          providerPaymentId: 'pp_OLD_111',
          previousProviderPaymentIds: [],
        },
      }),
    )
    prisma.payment.upsert.mockResolvedValue({ id: 'pay1' })
    ;(mockStripe.createPaymentIntent as jest.Mock).mockResolvedValue({
      providerPaymentId: 'pi_NEW_222',
      clientSecret: 'cs_secret',
      status: 'requires_confirmation',
    })

    const { service } = await makeService(prisma)
    await service.createPayment({ orderId: 'order1', method: 'stripe_card' } as any, 'user1', 'corr1')

    // No Stripe cancel (that is for the NEW provider; old was PayPal which has none)
    expect(mockStripe.cancelPaymentIntent).not.toHaveBeenCalled()

    // But fallback array is still updated — that is what catches a late PayPal capture
    const upsertArgs = prisma.payment.upsert.mock.calls[0][0]
    expect(upsertArgs.update.previousProviderPaymentIds).toContain('pp_OLD_111')
  })

  it('preserves the existing fallback array across repeated switches (Stripe → PayPal → Stripe)', async () => {
    const prisma = buildPrisma()
    prisma.order.findFirst.mockResolvedValue(
      pendingOrderRow({
        payment: {
          id: 'pay1',
          status: 'pending',
          provider: 'PAYPAL',
          providerPaymentId: 'pp_MIDDLE_222',
          previousProviderPaymentIds: ['pi_OLD_111'],
        },
      }),
    )
    prisma.payment.upsert.mockResolvedValue({ id: 'pay1' })
    ;(mockStripe.createPaymentIntent as jest.Mock).mockResolvedValue({
      providerPaymentId: 'pi_NEW_333',
      clientSecret: 'cs',
      status: 'requires_confirmation',
    })

    const { service } = await makeService(prisma)
    await service.createPayment({ orderId: 'order1', method: 'stripe_card' } as any, 'user1', 'corr1')

    const upsertArgs = prisma.payment.upsert.mock.calls[0][0]
    // Both old IDs must survive so a late webhook on EITHER can still find the row
    expect(upsertArgs.update.previousProviderPaymentIds).toEqual(
      expect.arrayContaining(['pi_OLD_111', 'pp_MIDDLE_222']),
    )
  })

  it('does NOT push or cancel when the "switch" is actually a retry with the same ID', async () => {
    const prisma = buildPrisma()
    prisma.order.findFirst.mockResolvedValue(
      pendingOrderRow({
        payment: {
          id: 'pay1',
          status: 'failed',
          provider: 'STRIPE',
          providerPaymentId: 'pi_SAME_111',
          previousProviderPaymentIds: [],
        },
      }),
    )
    prisma.payment.upsert.mockResolvedValue({ id: 'pay1' })
    ;(mockStripe.createPaymentIntent as jest.Mock).mockResolvedValue({
      providerPaymentId: 'pi_SAME_111', // provider returned same id (idempotent retry)
      clientSecret: 'cs',
      status: 'requires_confirmation',
    })

    const { service } = await makeService(prisma)
    await service.createPayment({ orderId: 'order1', method: 'stripe_card' } as any, 'user1', 'corr1')

    // Nothing to cancel — it is the SAME intent
    expect(mockStripe.cancelPaymentIntent).not.toHaveBeenCalled()

    const upsertArgs = prisma.payment.upsert.mock.calls[0][0]
    expect(upsertArgs.update.previousProviderPaymentIds).not.toContain('pi_SAME_111')
  })
})

describe('PaymentsService — webhook fallback lookup', () => {
  const orderPatch = { id: 'order1', orderNumber: 'ORD-2026-00001', status: 'pending_payment', notes: null }

  describe('handlePaymentSuccess', () => {
    it('direct hit: standard capture when providerPaymentId matches', async () => {
      const prisma = buildPrisma()
      // First findFirst: direct lookup succeeds
      prisma.payment.findFirst.mockResolvedValueOnce({
        id: 'pay1',
        status: 'pending',
        providerPaymentId: 'pi_DIRECT',
        previousProviderPaymentIds: [],
        provider: 'STRIPE',
        order: orderPatch,
      })

      const { service } = await makeService(prisma)
      await service.handlePaymentSuccess('pi_DIRECT', 'STRIPE', 'corr1')

      // Exactly ONE findFirst (no fallback query)
      expect(prisma.payment.findFirst).toHaveBeenCalledTimes(1)
      // Payment updated with plain status=captured — no provider rewrite
      const updateCall = prisma.payment.update.mock.calls[0][0]
      expect(updateCall.data.status).toBe('captured')
      expect(updateCall.data.provider).toBeUndefined()
    })

    it('fallback hit: finds payment via previousProviderPaymentIds', async () => {
      const prisma = buildPrisma()
      // Direct lookup misses, fallback lookup hits
      prisma.payment.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'pay1',
          status: 'pending',
          providerPaymentId: 'pp_NEW_BBB', // current active
          previousProviderPaymentIds: ['pi_ABANDONED_AAA'],
          provider: 'PAYPAL',
          order: orderPatch,
        })

      const { service } = await makeService(prisma)
      await service.handlePaymentSuccess('pi_ABANDONED_AAA', 'STRIPE', 'corr1')

      expect(prisma.payment.findFirst).toHaveBeenCalledTimes(2)

      // Second query: the fallback
      const fallbackCall = prisma.payment.findFirst.mock.calls[1][0]
      expect(fallbackCall.where.previousProviderPaymentIds).toEqual({ has: 'pi_ABANDONED_AAA' })

      // Payment was captured AND rewritten so refunds hit STRIPE going forward
      const updateCall = prisma.payment.update.mock.calls[0][0]
      expect(updateCall.data.status).toBe('captured')
      expect(updateCall.data.provider).toBe('STRIPE')
      expect(updateCall.data.providerPaymentId).toBe('pi_ABANDONED_AAA')
      // Old current active (pp_NEW_BBB) is demoted to the fallback array so a
      // late webhook on it still finds the row for idempotent skip
      expect(updateCall.data.previousProviderPaymentIds).toContain('pp_NEW_BBB')
    })

    it('fallback hit: idempotent skip if payment already captured', async () => {
      const prisma = buildPrisma()
      prisma.payment.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'pay1',
          status: 'captured', // already captured by earlier webhook
          providerPaymentId: 'pp_NEW_BBB',
          previousProviderPaymentIds: ['pi_ABANDONED_AAA'],
          provider: 'PAYPAL',
          order: orderPatch,
        })

      const { service } = await makeService(prisma)
      await service.handlePaymentSuccess('pi_ABANDONED_AAA', 'STRIPE', 'corr1')

      // Nothing written
      expect(prisma.payment.update).not.toHaveBeenCalled()
      expect(prisma.order.update).not.toHaveBeenCalled()
    })

    it('returns cleanly when neither direct nor fallback finds anything', async () => {
      const prisma = buildPrisma()
      prisma.payment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

      const { service } = await makeService(prisma)
      await expect(
        service.handlePaymentSuccess('pi_GHOST', 'STRIPE', 'corr1'),
      ).resolves.toBeUndefined()

      expect(prisma.payment.update).not.toHaveBeenCalled()
    })
  })

  describe('handlePaymentFailure', () => {
    it('direct hit: cancels order as before', async () => {
      const prisma = buildPrisma()
      prisma.payment.findFirst.mockResolvedValueOnce({
        id: 'pay1',
        status: 'pending',
        providerPaymentId: 'pi_DIRECT',
        previousProviderPaymentIds: [],
        order: orderPatch,
      })

      const { service } = await makeService(prisma)
      await service.handlePaymentFailure('pi_DIRECT', 'card_declined', 'corr1')

      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
      )
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled' }) }),
      )
    })

    it('fallback hit: logs and returns without touching payment or order (the active intent may still succeed)', async () => {
      const prisma = buildPrisma()
      prisma.payment.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'pay1',
          status: 'pending',
          providerPaymentId: 'pp_NEW_BBB',
          previousProviderPaymentIds: ['pi_ABANDONED_AAA'],
          order: orderPatch,
        })

      const { service } = await makeService(prisma)
      await service.handlePaymentFailure('pi_ABANDONED_AAA', 'card_declined', 'corr1')

      // Crucial: DO NOT flip payment to failed or cancel the order
      expect(prisma.payment.update).not.toHaveBeenCalled()
      expect(prisma.order.update).not.toHaveBeenCalled()
    })
  })

  describe('handleDispute', () => {
    it('direct hit: marks order as disputed', async () => {
      const prisma = buildPrisma()
      prisma.payment.findFirst.mockResolvedValueOnce({
        id: 'pay1',
        status: 'captured',
        providerPaymentId: 'pi_DIRECT',
        previousProviderPaymentIds: [],
        amount: 100,
        order: { id: 'order1', orderNumber: 'ORD-2026-00001', status: 'confirmed' },
      })

      const { service, eventEmitter } = await makeService(prisma)
      await service.handleDispute('pi_DIRECT', 'fraudulent', 'corr1')

      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'disputed' }) }),
      )
      expect(eventEmitter.emit).toHaveBeenCalledWith('payment.disputed', expect.any(Object))
    })

    it('fallback hit: alerts admins but does NOT flip order state automatically', async () => {
      const prisma = buildPrisma()
      prisma.payment.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'pay1',
          status: 'captured',
          providerPaymentId: 'pp_ACTIVE_BBB',
          previousProviderPaymentIds: ['pi_OLD_AAA'],
          amount: 100,
          order: { id: 'order1', orderNumber: 'ORD-2026-00001', status: 'confirmed' },
        })

      const { service, eventEmitter } = await makeService(prisma)
      await service.handleDispute('pi_OLD_AAA', 'fraudulent', 'corr1')

      // No automatic order state change — admins review manually
      expect(prisma.order.update).not.toHaveBeenCalled()
      // But the alert fires so admins SEE it
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'payment.disputed',
        expect.objectContaining({ reason: expect.stringContaining('FALLBACK') }),
      )
    })
  })
})
