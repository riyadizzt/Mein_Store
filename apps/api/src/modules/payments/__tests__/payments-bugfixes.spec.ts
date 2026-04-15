/**
 * Regression tests for the 15-bug fix pass.
 *
 * Each test pins a specific bug fix so a regression would fail loudly:
 *   - Bug 1: JSON.parse on order.notes must not crash on garbage input
 *   - Bug 8: dispute handler must emit `payment.disputed` for the notification listener
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
  generateAndStoreInvoice: jest.fn().mockResolvedValue({ invoice: { id: 'inv1' }, pdfBuffer: Buffer.alloc(0) }),
  generateAndStoreCreditNote: jest.fn().mockResolvedValue({ invoice: { id: 'gs1' }, pdfBuffer: Buffer.alloc(0) }),
}

function buildPrisma() {
  const mock: any = {
    payment: { findFirst: jest.fn(), update: jest.fn() },
    order: { update: jest.fn(), findUnique: jest.fn() },
    orderStatusHistory: { create: jest.fn() },
  }
  mock.$transaction = jest.fn().mockImplementation((fnOrArray: any) =>
    typeof fnOrArray === 'function' ? fnOrArray(mock) : Promise.all(fnOrArray),
  )
  return mock
}

async function makeService(prisma: any, eventEmitter: { emit: jest.Mock; emitAsync?: jest.Mock }) {
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

describe('PaymentsService — bug-fix regression', () => {
  let prisma: any
  let eventEmitter: { emit: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = buildPrisma()
    eventEmitter = { emit: jest.fn() }
  })

  describe('Bug 1: JSON.parse(order.notes) tolerates garbage input', () => {
    it('handlePaymentSuccess does NOT crash when notes is malformed JSON', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay1',
        status: 'pending',
        order: {
          id: 'order1',
          orderNumber: 'ORD-0001',
          status: 'pending_payment',
          notes: '{not valid json',
        },
        providerPaymentId: 'pi_x',
      })

      const service = await makeService(prisma, eventEmitter)

      // Should NOT throw despite malformed JSON
      await expect(
        service.handlePaymentSuccess('pi_x', 'STRIPE', 'corr1'),
      ).resolves.not.toThrow()

      // Order should still be confirmed (notes also get set with tokens)
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'confirmed' }),
        }),
      )

      // No reservation event since notes was garbage → reservationIds = []
      const reservationCalls = eventEmitter.emit.mock.calls.filter(
        (c) => c[0] === 'order.confirmed',
      )
      expect(reservationCalls).toHaveLength(0)
    })

    it('handlePaymentSuccess parses VALID notes and emits reservation event', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay1',
        status: 'pending',
        order: {
          id: 'order1',
          orderNumber: 'ORD-0002',
          status: 'pending_payment',
          notes: JSON.stringify({ reservationIds: ['res-A', 'res-B'] }),
        },
        providerPaymentId: 'pi_y',
      })

      const service = await makeService(prisma, eventEmitter)
      await service.handlePaymentSuccess('pi_y', 'STRIPE', 'corr2')

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'order.confirmed',
        expect.objectContaining({ reservationIds: ['res-A', 'res-B'] }),
      )
    })

    it('handlePaymentFailure tolerates malformed notes', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay1',
        status: 'pending',
        order: {
          id: 'order1',
          orderNumber: 'ORD-0003',
          status: 'pending_payment',
          notes: 'undefined',
        },
        providerPaymentId: 'pi_z',
      })

      const service = await makeService(prisma, eventEmitter)
      await expect(
        service.handlePaymentFailure('pi_z', 'card_declined', 'corr3'),
      ).resolves.not.toThrow()
    })
  })

  describe('Bug 8: dispute emits payment.disputed event for notifications', () => {
    it('handleDispute emits payment.disputed with full payload', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay1',
        amount: 99.99,
        order: {
          id: 'order1',
          orderNumber: 'ORD-0004',
          status: 'confirmed',
        },
        providerPaymentId: 'pi_dispute',
      })

      const service = await makeService(prisma, eventEmitter)
      await service.handleDispute('pi_dispute', 'fraudulent', 'corr-d')

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'payment.disputed',
        expect.objectContaining({
          paymentId: 'pay1',
          orderId: 'order1',
          orderNumber: 'ORD-0004',
          amount: 99.99,
          reason: 'fraudulent',
          correlationId: 'corr-d',
        }),
      )
    })

    it('handleDispute still marks order as disputed', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay2',
        amount: 50,
        order: { id: 'order2', orderNumber: 'ORD-0005', status: 'confirmed' },
        providerPaymentId: 'pi_d2',
      })

      const service = await makeService(prisma, eventEmitter)
      await service.handleDispute('pi_d2', 'product_not_received', 'corr-d2')

      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'disputed' } }),
      )
    })
  })

  describe('Bug: webhook path must generate guest inviteToken', () => {
    // Previously only markAsCaptured (manual admin confirm, Vorkasse) generated
    // the inviteToken used by the guest-invite email template. Stripe/PayPal/
    // Klarna/SumUp guest customers silently got no "create account" link.
    //
    // Second iteration: orders.service.ts actually creates a STUB user with
    // passwordHash=null for every guest checkout, so "isGuest = !userId" was
    // wrong — the correct signal is user.passwordHash === null.

    it('generates inviteToken for a STUB-USER guest order (passwordHash=null)', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay1',
        status: 'pending',
        providerPaymentId: 'pi_stub_1',
        previousProviderPaymentIds: [],
        order: {
          id: 'order1',
          orderNumber: 'ORD-STUB-001',
          status: 'pending_payment',
          notes: null,
          userId: 'stub-user-id',       // userId IS set
          guestEmail: null,             // but guestEmail is null
          user: {
            passwordHash: null,         // ← stub marker
            email: 'stub@example.com',
            isVerified: false,          // ← real stub, not a legacy OAuth user
            oauthAccounts: [],          // ← no Google/Facebook link
          },
        },
      })

      const service = await makeService(prisma, eventEmitter)
      await service.handlePaymentSuccess('pi_stub_1', 'STRIPE', 'corr-stub-1')

      const updateCall = prisma.order.update.mock.calls[0][0]
      const savedNotes = JSON.parse(updateCall.data.notes)
      expect(savedNotes.inviteToken).toMatch(/^[0-9a-f-]{36}$/)
      expect(savedNotes.confirmationToken).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('does NOT generate inviteToken for a REAL user (passwordHash set)', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay1',
        status: 'pending',
        providerPaymentId: 'pi_real_1',
        previousProviderPaymentIds: [],
        order: {
          id: 'order1',
          orderNumber: 'ORD-REAL-001',
          status: 'pending_payment',
          notes: null,
          userId: 'real-user-id',
          guestEmail: null,
          user: {
            passwordHash: '$argon2id$v=19$...', // ← real password
            email: 'real@example.com',
            isVerified: true,
            oauthAccounts: [],
          },
        },
      })

      const service = await makeService(prisma, eventEmitter)
      await service.handlePaymentSuccess('pi_real_1', 'STRIPE', 'corr-real-1')

      const updateCall = prisma.order.update.mock.calls[0][0]
      const savedNotes = JSON.parse(updateCall.data.notes)
      expect(savedNotes.inviteToken).toBeUndefined()
      // confirmationToken always generated (used by other flows)
      expect(savedNotes.confirmationToken).toBeDefined()
    })

    // Regression test for 15.04.2026 incident: Google/Facebook users
    // were falsely classified as stub-guests because they have no
    // passwordHash either. The 3-signal check must exclude them via
    // the oauthAccounts link (for users who logged in after the
    // 14.04.2026 upsert-fix) OR via isVerified (for legacy users).
    it('does NOT generate inviteToken for a Google OAuth user (oauthAccounts linked)', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay1',
        status: 'pending',
        providerPaymentId: 'pi_google_1',
        previousProviderPaymentIds: [],
        order: {
          id: 'order1',
          orderNumber: 'ORD-GOOG-001',
          status: 'pending_payment',
          notes: null,
          userId: 'google-user-id',
          guestEmail: null,
          user: {
            passwordHash: null,          // OAuth users have no password
            email: 'cro.defi.mail@gmail.com',
            isVerified: true,            // Google auto-verifies
            oauthAccounts: [{ id: 'oa1' }], // ← Google link present
          },
        },
      })

      const service = await makeService(prisma, eventEmitter)
      await service.handlePaymentSuccess('pi_google_1', 'STRIPE', 'corr-google-1')

      const updateCall = prisma.order.update.mock.calls[0][0]
      const savedNotes = JSON.parse(updateCall.data.notes)
      // Google user already has an account — must NOT receive an invite
      expect(savedNotes.inviteToken).toBeUndefined()
      // confirmationToken still generated (used for return-link etc.)
      expect(savedNotes.confirmationToken).toMatch(/^[0-9a-f-]{36}$/)
    })

    // Pre-14.04.2026 Google users don't have an oauthAccounts row (the
    // upsert was only added on that date). For them the isVerified flag
    // is the only way to tell them apart from a real stub guest.
    it('does NOT generate inviteToken for a LEGACY OAuth user (isVerified=true, no oauthAccounts row)', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay1',
        status: 'pending',
        providerPaymentId: 'pi_legacy_1',
        previousProviderPaymentIds: [],
        order: {
          id: 'order1',
          orderNumber: 'ORD-LEG-001',
          status: 'pending_payment',
          notes: null,
          userId: 'legacy-oauth-id',
          guestEmail: null,
          user: {
            passwordHash: null,
            email: 'legacy@example.com',
            isVerified: true,            // ← legacy marker
            oauthAccounts: [],           // no row because they logged in before 14.04
          },
        },
      })

      const service = await makeService(prisma, eventEmitter)
      await service.handlePaymentSuccess('pi_legacy_1', 'STRIPE', 'corr-legacy-1')

      const updateCall = prisma.order.update.mock.calls[0][0]
      const savedNotes = JSON.parse(updateCall.data.notes)
      expect(savedNotes.inviteToken).toBeUndefined()
      expect(savedNotes.confirmationToken).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('still handles the pure-guest case (userId=null, guestEmail set)', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay1',
        status: 'pending',
        providerPaymentId: 'pi_guest_1',
        previousProviderPaymentIds: [],
        order: {
          id: 'order1',
          orderNumber: 'ORD-GUEST-001',
          status: 'pending_payment',
          notes: null,
          userId: null,
          guestEmail: 'guest@example.com',
          user: null,
        },
      })

      const service = await makeService(prisma, eventEmitter)
      await service.handlePaymentSuccess('pi_guest_1', 'STRIPE', 'corr-guest-1')

      // order.update must carry the notes with both tokens
      const updateCall = prisma.order.update.mock.calls[0][0]
      expect(updateCall.data.status).toBe('confirmed')
      const savedNotes = JSON.parse(updateCall.data.notes)
      expect(savedNotes.inviteToken).toMatch(/^[0-9a-f-]{36}$/)
      expect(savedNotes.confirmationToken).toMatch(/^[0-9a-f-]{36}$/)
      expect(savedNotes.inviteToken).not.toEqual(savedNotes.confirmationToken)
    })

    it('does NOT generate inviteToken for a LOGGED-IN user order', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay1',
        status: 'pending',
        providerPaymentId: 'pi_user_1',
        previousProviderPaymentIds: [],
        order: {
          id: 'order1',
          orderNumber: 'ORD-USER-001',
          status: 'pending_payment',
          notes: null,
          userId: 'user-xyz', // logged in
          guestEmail: null,
        },
      })

      const service = await makeService(prisma, eventEmitter)
      await service.handlePaymentSuccess('pi_user_1', 'STRIPE', 'corr-user-1')

      const updateCall = prisma.order.update.mock.calls[0][0]
      const savedNotes = JSON.parse(updateCall.data.notes)
      // No invite (they already have an account) — but confirmationToken still exists
      expect(savedNotes.inviteToken).toBeUndefined()
      expect(savedNotes.confirmationToken).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('preserves existing reservationIds when adding tokens', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay1',
        status: 'pending',
        providerPaymentId: 'pi_guest_2',
        previousProviderPaymentIds: [],
        order: {
          id: 'order1',
          orderNumber: 'ORD-GUEST-002',
          status: 'pending_payment',
          notes: JSON.stringify({ reservationIds: ['res-A', 'res-B'] }),
          userId: null,
          guestEmail: 'guest2@example.com',
        },
      })

      const service = await makeService(prisma, eventEmitter)
      await service.handlePaymentSuccess('pi_guest_2', 'STRIPE', 'corr-guest-2')

      const updateCall = prisma.order.update.mock.calls[0][0]
      const savedNotes = JSON.parse(updateCall.data.notes)
      expect(savedNotes.reservationIds).toEqual(['res-A', 'res-B'])
      expect(savedNotes.inviteToken).toBeDefined()
      expect(savedNotes.confirmationToken).toBeDefined()

      // Inventory event still fires with the right reservationIds
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'order.confirmed',
        expect.objectContaining({ reservationIds: ['res-A', 'res-B'] }),
      )
    })

    it('does NOT overwrite an existing inviteToken on a second webhook hit', async () => {
      // Webhook fires twice (Stripe retry or dupe) — the token must stay stable
      // so any already-sent invite link keeps working.
      const existingToken = '11111111-2222-3333-4444-555555555555'
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay1',
        status: 'pending',
        providerPaymentId: 'pi_guest_3',
        previousProviderPaymentIds: [],
        order: {
          id: 'order1',
          orderNumber: 'ORD-GUEST-003',
          status: 'pending_payment',
          notes: JSON.stringify({ inviteToken: existingToken }),
          userId: null,
          guestEmail: 'guest3@example.com',
        },
      })

      const service = await makeService(prisma, eventEmitter)
      await service.handlePaymentSuccess('pi_guest_3', 'STRIPE', 'corr-guest-3')

      const updateCall = prisma.order.update.mock.calls[0][0]
      const savedNotes = JSON.parse(updateCall.data.notes)
      expect(savedNotes.inviteToken).toBe(existingToken)
    })
  })

  // Regression for 15.04.2026 incident: markAsCaptured (manual Vorkasse
  // admin confirm) never emitted ORDER_EVENTS.CONFIRMED, so the
  // InventoryListener.handleOrderConfirmed branch never ran and
  // StockReservation rows stayed RESERVED until the expiry cron
  // swept them — without ever decrementing quantityOnHand. Result:
  // Vorkasse orders got paid but stock was never deducted.
  describe('Bug: markAsCaptured must emit ORDER_CONFIRMED for Vorkasse flow', () => {
    it('emittet ORDER_CONFIRMED mit reservationIds aus notes wenn vorhanden', async () => {
      prisma.payment.update.mockResolvedValue({})
      prisma.order.findUnique.mockResolvedValue({
        status: 'pending_payment',
        orderNumber: 'ORD-VKS-001',
        notes: JSON.stringify({
          reservationIds: ['res-vk-1', 'res-vk-2'],
          locale: 'de',
        }),
      })
      prisma.order.update.mockResolvedValue({})

      const service = await makeService(prisma, eventEmitter)
      await service.markAsCaptured('order-vorkasse-1')

      // Must have emitted ORDER_EVENTS.CONFIRMED ('order.confirmed')
      const confirmedCalls = eventEmitter.emit.mock.calls.filter(
        (call: any) => call[0] === 'order.confirmed',
      )
      expect(confirmedCalls.length).toBe(1)
      // And the payload must carry the reservation ids
      const payload = confirmedCalls[0][1]
      expect(payload.reservationIds).toEqual(['res-vk-1', 'res-vk-2'])
      expect(payload.orderId).toBe('order-vorkasse-1')
      expect(payload.orderNumber).toBe('ORD-VKS-001')
    })

    it('emittet KEIN ORDER_CONFIRMED wenn notes.reservationIds leer/fehlt', async () => {
      prisma.payment.update.mockResolvedValue({})
      prisma.order.findUnique.mockResolvedValue({
        status: 'pending_payment',
        orderNumber: 'ORD-LEG-001',
        notes: JSON.stringify({ locale: 'de' }),  // no reservationIds
      })
      prisma.order.update.mockResolvedValue({})

      const service = await makeService(prisma, eventEmitter)
      await service.markAsCaptured('order-legacy-1')

      const confirmedCalls = eventEmitter.emit.mock.calls.filter(
        (call: any) => call[0] === 'order.confirmed',
      )
      expect(confirmedCalls.length).toBe(0)
      // Legacy order still gets status_changed emit (for email)
      const statusCalls = eventEmitter.emit.mock.calls.filter(
        (call: any) => call[0] === 'order.status_changed',
      )
      expect(statusCalls.length).toBe(1)
    })

    it('emittet KEIN ORDER_CONFIRMED wenn Order bereits confirmed war', async () => {
      prisma.payment.update.mockResolvedValue({})
      prisma.order.findUnique.mockResolvedValue({
        status: 'confirmed',  // already confirmed — idempotent call
        orderNumber: 'ORD-IDEM-001',
        notes: JSON.stringify({ reservationIds: ['r1'] }),
      })
      prisma.order.update.mockResolvedValue({})

      const service = await makeService(prisma, eventEmitter)
      await service.markAsCaptured('order-idem-1')

      // No status transition → no ORDER_CONFIRMED re-emit → no double confirm
      const confirmedCalls = eventEmitter.emit.mock.calls.filter(
        (call: any) => call[0] === 'order.confirmed',
      )
      expect(confirmedCalls.length).toBe(0)
    })
  })
})
