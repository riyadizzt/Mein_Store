import {
  Injectable,
  Logger,
  Inject,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import * as crypto from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { IPaymentProvider, PAYMENT_PROVIDERS } from './payment-provider.interface'
import { CreatePaymentDto } from './dto/create-payment.dto'
import { CreateRefundDto } from './dto/create-refund.dto'
import { PaymentFailedException } from './exceptions/payment-failed.exception'
import { InvoiceService } from './invoice.service'
import { ORDER_EVENTS, OrderStatusChangedEvent } from '../orders/events/order.events'

// Map PaymentMethod enum → PaymentProvider
const METHOD_TO_PROVIDER: Record<string, string> = {
  stripe_card: 'STRIPE',
  apple_pay: 'STRIPE',
  google_pay: 'STRIPE',
  klarna_pay_now: 'KLARNA',
  klarna_pay_later: 'KLARNA',
  klarna_installments: 'KLARNA',
  paypal: 'PAYPAL',
  sepa_direct_debit: 'STRIPE',
  giropay: 'STRIPE',
  vorkasse: 'VORKASSE',
  sumup: 'SUMUP',
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name)
  private readonly providerMap: Map<string, IPaymentProvider>

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly invoiceService: InvoiceService,
    @Inject(PAYMENT_PROVIDERS) providers: IPaymentProvider[],
  ) {
    this.providerMap = new Map(providers.map((p) => [p.providerName, p]))
  }

  async findByOrderId(orderId: string) {
    return this.prisma.payment.findUnique({ where: { orderId } })
  }

  /** Store the provider's transaction ID for refunds (SumUp: transaction_id != checkout_id) */
  async updateProviderRefundId(paymentId: string, transactionId: string) {
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: { metadata: { sumupTransactionId: transactionId } },
    })
  }

  async markAsCaptured(orderId: string) {
    // Update payment status if still pending
    try {
      await this.prisma.payment.update({
        where: { orderId },
        data: { status: 'captured' },
      })
    } catch {
      // Payment might not exist for this order or already captured — continue
    }

    // Update order status if not already confirmed+
    const currentOrder = await this.prisma.order.findUnique({ where: { id: orderId }, select: { status: true, notes: true, orderNumber: true } })
    if (!currentOrder) return { status: 'not_found' }

    if (currentOrder.status === 'pending' || currentOrder.status === 'pending_payment') {
      await this.prisma.order.update({ where: { id: orderId }, data: { status: 'confirmed' } })
    }

    // Generate tokens
    const confirmationToken = crypto.randomUUID()
    const inviteToken = crypto.randomUUID() // For guest account creation
    const existingNotes = (() => { try { return JSON.parse(currentOrder.notes ?? '{}') } catch { return {} } })()
    await this.prisma.order.update({
      where: { id: orderId },
      data: { notes: JSON.stringify({ ...existingNotes, confirmationToken, inviteToken }) },
    })

    // Emit status changed event so email listener sends invite + status emails
    if (currentOrder.status === 'pending' || currentOrder.status === 'pending_payment') {
      try {
        this.eventEmitter.emit('order.status_changed', {
          orderId,
          orderNumber: currentOrder.orderNumber,
          fromStatus: currentOrder.status,
          toStatus: 'confirmed',
          correlationId: 'payment-confirm',
        })
      } catch {}
    }

    this.logger.log(`Confirmation token for order ${orderId}: ${confirmationToken}`)

    // Auto-generate invoice on manual confirm
    try {
      const { invoice, pdfBuffer } = await this.invoiceService.generateAndStoreInvoice(orderId)
      this.eventEmitter.emit('invoice.generated', {
        orderId,
        orderNumber: currentOrder.orderNumber,
        invoiceNumber: invoice.invoiceNumber,
        grossAmount: Number(invoice.grossAmount).toFixed(2),
        pdfBuffer,
        correlationId: 'payment-confirm',
      })
    } catch (err) {
      this.logger.error(`Invoice generation failed on manual confirm for order ${orderId}: ${err}`)
    }

    return { status: 'captured', orderId, orderNumber: currentOrder.orderNumber, confirmationToken }
  }

  // ── CREATE PAYMENT ─────────────────────────────────────────

  async createPayment(dto: CreatePaymentDto, userId: string | null, correlationId: string) {
    // 1. Validate order — if logged in check ownership, if guest just find by ID
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, ...(userId ? { userId } : {}), deletedAt: null },
      include: {
        user: { select: { email: true, firstName: true, lastName: true } },
        payment: true,
      },
    })

    if (!order) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'OrderNotFound',
        message: {
          de: 'Bestellung nicht gefunden.',
          en: 'Order not found.',
          ar: 'الطلب غير موجود.',
        },
      })
    }

    // Guard: only pending or pending_payment orders
    if (!['pending', 'pending_payment'].includes(order.status)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'InvalidOrderState',
        message: {
          de: `Zahlung nicht möglich für Status: ${order.status}`,
          en: `Payment not possible for status: ${order.status}`,
          ar: `لا يمكن الدفع للحالة: ${order.status}`,
        },
      })
    }

    // Guard: no existing active payment
    if (order.payment && ['authorized', 'captured'].includes(order.payment.status)) {
      throw new ConflictException({
        statusCode: 409,
        error: 'PaymentAlreadyExists',
        message: {
          de: 'Für diese Bestellung existiert bereits eine Zahlung.',
          en: 'A payment already exists for this order.',
          ar: 'يوجد دفع مسبق لهذا الطلب.',
        },
      })
    }

    // 2. Resolve provider
    const providerName = METHOD_TO_PROVIDER[dto.method]
    if (!providerName) throw new PaymentFailedException('Unsupported payment method')

    const provider = this.providerMap.get(providerName)
    if (!provider) throw new PaymentFailedException(`Provider ${providerName} not configured`)

    // 3. Amount is ALWAYS server-calculated — NEVER from frontend
    const amountCents = Math.round(Number(order.totalAmount) * 100)

    // 4. Idempotency key
    const idempotencyKey = dto.idempotencyKey ?? crypto.randomUUID()

    // 5. Create payment intent via provider
    const intentResult = await provider.createPaymentIntent({
      orderId: order.id,
      amount: amountCents,
      currency: order.currency,
      method: dto.method,
      customerEmail: order.user?.email ?? order.guestEmail ?? '',
      customerName: order.user ? `${order.user.firstName} ${order.user.lastName}` : 'Guest',
      metadata: { correlationId, orderNumber: order.orderNumber },
      idempotencyKey,
    })

    // 6. Persist payment record.
    //
    // Method-switch safety: if an existing pending/failed payment row is being
    // replaced with a new provider intent, we must preserve the old
    // providerPaymentId so a late webhook on the abandoned intent can still
    // be matched (fallback lookup in handlePaymentSuccess/Failure/Dispute).
    // Dropping the old ID here would mean captured money on the old intent
    // could land without ever reaching our DB.
    const oldProviderPaymentId = order.payment?.providerPaymentId ?? null
    const oldProviderName = order.payment?.provider ?? null
    const isSwitching =
      !!oldProviderPaymentId && oldProviderPaymentId !== intentResult.providerPaymentId

    const previousIds: string[] = isSwitching
      ? Array.from(
          new Set([
            ...((order.payment as any)?.previousProviderPaymentIds ?? []),
            oldProviderPaymentId!,
          ]),
        )
      : ((order.payment as any)?.previousProviderPaymentIds ?? [])

    const payment = await this.prisma.payment.upsert({
      where: { orderId: order.id },
      create: {
        orderId: order.id,
        provider: providerName as any,
        method: dto.method,
        status: 'pending',
        amount: order.totalAmount,
        currency: order.currency,
        providerPaymentId: intentResult.providerPaymentId,
        providerClientSecret: intentResult.clientSecret,
        idempotencyKey,
      },
      update: {
        provider: providerName as any,
        method: dto.method,
        status: 'pending',
        providerPaymentId: intentResult.providerPaymentId,
        previousProviderPaymentIds: previousIds,
        providerClientSecret: intentResult.clientSecret,
        idempotencyKey,
        failureReason: null,
      },
    })

    // Best-effort: tell the old provider to cancel the abandoned intent so no
    // webhook can fire on it in the first place. Only Stripe currently
    // supports programmatic cancel — PayPal/Klarna/SumUp intents expire at
    // the provider on their own schedule, which is why the previousIds
    // fallback above is the actual safety net for those.
    //
    // NEVER let a cancel failure block the new payment — the fallback path
    // still protects us if the old intent eventually fires.
    if (isSwitching && oldProviderName) {
      const oldProvider = this.providerMap.get(oldProviderName)
      if (oldProvider?.cancelPaymentIntent) {
        try {
          await oldProvider.cancelPaymentIntent(oldProviderPaymentId!)
          this.logger.log(
            `[${correlationId}] Old intent cancelled at ${oldProviderName}: ${oldProviderPaymentId}`,
          )
        } catch (err) {
          this.logger.warn(
            `[${correlationId}] Best-effort cancel on ${oldProviderName} failed for ${oldProviderPaymentId}: ${(err as Error).message} — relying on previousProviderPaymentIds fallback`,
          )
        }
      }
    }

    // 7. Update order status to pending_payment
    if (order.status === 'pending') {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'pending_payment' },
      })
    }

    this.logger.log(
      `[${correlationId}] Payment created: ${payment.id} | provider=${providerName} | method=${dto.method} | orderId=${order.id}`,
    )

    return {
      paymentId: payment.id,
      providerPaymentId: intentResult.providerPaymentId,
      clientSecret: intentResult.clientSecret,
      status: intentResult.status,
      redirectUrl: intentResult.redirectUrl,
    }
  }

  // ── CONFIRM VORKASSE PAYMENT (admin action) ────────────────

  async confirmVorkassePayment(orderId: string, adminUserId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payment: true },
    })

    if (!order) throw new NotFoundException('Order not found')
    if (!order.payment || order.payment.provider !== 'VORKASSE') {
      throw new BadRequestException('This order does not use Vorkasse payment')
    }
    if (order.payment.status === 'captured') {
      throw new BadRequestException('Payment already confirmed')
    }

    // Mark payment as captured
    await this.prisma.payment.update({
      where: { orderId },
      data: { status: 'captured', paidAt: new Date() },
    })

    // Use the standard markAsCaptured flow for order confirmation + invoice
    const result = await this.markAsCaptured(orderId)

    // Audit log
    this.logger.log(`Vorkasse payment confirmed by admin ${adminUserId} for order ${order.orderNumber}`)

    return { ...result, confirmedBy: adminUserId }
  }

  // ── WEBHOOK PAYMENT LOOKUP (with method-switch fallback) ───
  //
  // Webhooks arrive by providerPaymentId. The direct lookup works 99% of the
  // time. But if the customer switched payment method on a pending order
  // (e.g. Stripe→PayPal), the row's current providerPaymentId now points at
  // the NEW attempt — so a late-firing webhook on the OLD intent would miss
  // and the captured money would be silently dropped.
  //
  // previousProviderPaymentIds (populated in createPayment on switch) is the
  // safety net: if direct lookup misses, try the array. isFallbackHit=true
  // tells callers that the success/failure actually belongs to an older
  // attempt, so they can reason about it correctly (e.g. handlePaymentSuccess
  // rewrites provider/providerPaymentId so refunds hit the right account).

  private async findPaymentForWebhook(providerPaymentId: string) {
    // `user` is included so we can detect stub guest accounts:
    // orders.service.ts creates a User with passwordHash=null for every guest
    // checkout (stub-user pattern), which means order.userId is ALWAYS set.
    // The only reliable "is this a guest" signal is user.passwordHash === null.
    const include = {
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          notes: true,
          userId: true,
          guestEmail: true,
          user: { select: { passwordHash: true, email: true } },
        },
      },
    } as const

    const direct = await this.prisma.payment.findFirst({
      where: { providerPaymentId },
      include,
    })
    if (direct) return { payment: direct, isFallbackHit: false }

    const fallback = await this.prisma.payment.findFirst({
      where: { previousProviderPaymentIds: { has: providerPaymentId } },
      include,
    })
    if (fallback) return { payment: fallback, isFallbackHit: true }

    return { payment: null, isFallbackHit: false }
  }

  // ── HANDLE PAYMENT SUCCESS (called from webhook) ───────────

  async handlePaymentSuccess(
    providerPaymentId: string,
    providerName: string,
    correlationId: string,
  ): Promise<void> {
    const { payment, isFallbackHit } = await this.findPaymentForWebhook(providerPaymentId)

    if (!payment) {
      this.logger.warn(`Payment not found for provider ID: ${providerPaymentId}`)
      return
    }

    if (payment.status === 'captured') {
      this.logger.debug(`Payment ${payment.id} already captured — skipping`)
      return
    }

    // Fallback hit = customer paid on an abandoned intent (e.g. old Stripe
    // tab after switching to PayPal). Rewrite provider + providerPaymentId to
    // match what actually charged so future refunds hit the right account.
    // The old "new" ID gets moved into the array so any subsequent webhook
    // on it (the expected, now-irrelevant one) is still findable and gets
    // the idempotent skip treatment instead of looking like a ghost event.
    if (isFallbackHit) {
      this.logger.warn(
        `[${correlationId}] FALLBACK capture: webhook for ${providerPaymentId} hit payment ${payment.id} via previousProviderPaymentIds. Customer paid on an abandoned ${providerName} intent after switching method. Rewriting provider to ${providerName}.`,
      )
    }

    // Guest orders need a one-time invite token so the confirmation email
    // can offer "create an account" to claim this stub user. This codebase
    // creates a stub User (passwordHash=null) for every guest checkout, so
    // userId is ALWAYS set and the old "!userId && guestEmail" check never
    // fired. The correct signal is user.passwordHash === null — only a real
    // (claimed) account has a password.
    let mergedNotes: any = {}
    try {
      mergedNotes = JSON.parse(payment.order.notes ?? '{}')
    } catch {
      // keep empty object on malformed notes
    }
    const orderUser: any = (payment.order as any).user
    const isStubGuestUser = orderUser && !orderUser.passwordHash && !!orderUser.email
    const hasNoUserAtAll =
      !(payment.order as any).userId && !!(payment.order as any).guestEmail
    const isGuest = isStubGuestUser || hasNoUserAtAll
    if (isGuest && !mergedNotes.inviteToken) {
      mergedNotes.inviteToken = crypto.randomUUID()
    }
    if (!mergedNotes.confirmationToken) {
      mergedNotes.confirmationToken = crypto.randomUUID()
    }
    const serializedNotes = JSON.stringify(mergedNotes)

    // DB transaction: Payment→CAPTURED, Order→CONFIRMED, Inventory→SOLD
    await this.prisma.$transaction(async (tx) => {
      // 1. Payment → captured
      await tx.payment.update({
        where: { id: payment.id },
        data: isFallbackHit
          ? {
              status: 'captured',
              paidAt: new Date(),
              provider: providerName as any,
              providerPaymentId,
              previousProviderPaymentIds: Array.from(
                new Set([
                  ...((payment as any).previousProviderPaymentIds ?? []).filter(
                    (id: string) => id !== providerPaymentId,
                  ),
                  payment.providerPaymentId,
                ].filter(Boolean)),
              ),
            }
          : { status: 'captured', paidAt: new Date() },
      })

      // 2. Order → confirmed (only if pending_payment) + persist tokens
      if (['pending', 'pending_payment'].includes(payment.order.status)) {
        await tx.order.update({
          where: { id: payment.order.id },
          data: { status: 'confirmed', notes: serializedNotes },
        })

        await tx.orderStatusHistory.create({
          data: {
            orderId: payment.order.id,
            fromStatus: payment.order.status as any,
            toStatus: 'confirmed',
            source: 'payment_webhook',
            referenceId: payment.providerPaymentId,
            createdBy: providerName,
          },
        })
      } else {
        // Already confirmed (rare — admin manual confirm before webhook)
        // still backfill the tokens in case markAsCaptured didn't run.
        await tx.order.update({
          where: { id: payment.order.id },
          data: { notes: serializedNotes },
        })
      }
    })

    // 3. Inventory: confirm reservation → deduct stock (via event).
    // mergedNotes already contains reservationIds from the original notes plus
    // our freshly-added tokens, so we reuse it without re-parsing.
    const reservationIds: string[] = mergedNotes.reservationIds ?? []

    if (reservationIds.length > 0) {
      this.eventEmitter.emit(ORDER_EVENTS.CONFIRMED, {
        orderId: payment.order.id,
        orderNumber: payment.order.orderNumber,
        correlationId,
        reservationIds,
      })
    }

    // 4. Trigger status changed event → email notification
    this.eventEmitter.emit(
      ORDER_EVENTS.STATUS_CHANGED,
      new OrderStatusChangedEvent(
        payment.order.id,
        payment.order.status,
        'confirmed',
        'payment_webhook',
        correlationId,
      ),
    )

    this.logger.log(
      `[${correlationId}] Payment SUCCESS: ${payment.id} | order=${payment.order.orderNumber} → confirmed`,
    )

    // Auto-generate invoice and emit event for email
    try {
      const { invoice, pdfBuffer } = await this.invoiceService.generateAndStoreInvoice(payment.order.id)
      this.eventEmitter.emit('invoice.generated', {
        orderId: payment.order.id,
        orderNumber: payment.order.orderNumber,
        invoiceNumber: invoice.invoiceNumber,
        grossAmount: Number(invoice.grossAmount).toFixed(2),
        pdfBuffer,
        correlationId,
      })
    } catch (err) {
      this.logger.error(`Invoice auto-generation failed for order ${payment.order.orderNumber}: ${err}`)
    }
  }

  // ── HANDLE PAYMENT FAILURE (called from webhook) ───────────

  async handlePaymentFailure(
    providerPaymentId: string,
    failureReason: string,
    correlationId: string,
  ): Promise<void> {
    const { payment, isFallbackHit } = await this.findPaymentForWebhook(providerPaymentId)

    if (!payment) return

    // Fallback = an OLD abandoned intent failed. The customer may still be
    // successfully completing the active (new) intent — do NOT touch payment
    // state or cancel the order. Just log it and move on.
    if (isFallbackHit) {
      this.logger.log(
        `[${correlationId}] Ignoring failure on abandoned intent ${providerPaymentId} for payment ${payment.id} — active intent remains ${payment.providerPaymentId}. Reason: ${failureReason}`,
      )
      return
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'failed', failureReason },
      })

      // Release inventory reservation
      if (['pending', 'pending_payment'].includes(payment.order.status)) {
        await tx.order.update({
          where: { id: payment.order.id },
          data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: `payment_failed: ${failureReason}` },
        })

        await tx.orderStatusHistory.create({
          data: {
            orderId: payment.order.id,
            fromStatus: payment.order.status as any,
            toStatus: 'cancelled',
            source: 'payment_webhook',
            notes: failureReason,
            createdBy: 'system',
          },
        })
      }
    })

    // Release inventory reservations
    let notes: any = {}
    if (payment.order.notes) {
      try {
        notes = JSON.parse(payment.order.notes)
      } catch (e) {
        this.logger.warn(
          `[${correlationId}] Failed to parse order.notes for order ${payment.order.orderNumber}: ${(e as Error).message}`,
        )
      }
    }
    const reservationIds: string[] = notes.reservationIds ?? []
    if (reservationIds.length > 0) {
      this.eventEmitter.emit(ORDER_EVENTS.CANCELLED, {
        orderId: payment.order.id,
        orderNumber: payment.order.orderNumber,
        correlationId,
        reason: `payment_failed: ${failureReason}`,
        reservationIds,
      })
    }

    this.logger.log(
      `[${correlationId}] Payment FAILED: ${payment.id} | order=${payment.order.orderNumber} → cancelled | reason=${failureReason}`,
    )
  }

  // ── HANDLE DISPUTE (called from webhook) ───────────────────

  async handleDispute(
    providerPaymentId: string,
    disputeReason: string,
    correlationId: string,
  ): Promise<void> {
    const { payment, isFallbackHit } = await this.findPaymentForWebhook(providerPaymentId)

    if (!payment) return

    // A dispute on an old abandoned intent is still a real dispute — money
    // WAS captured at that provider at some point. Log loudly and alert
    // admins, but don't corrupt order state automatically.
    if (isFallbackHit) {
      this.logger.error(
        `[${correlationId}] DISPUTE on abandoned intent ${providerPaymentId} — payment ${payment.id} has active intent ${payment.providerPaymentId}. Manual review required. Reason: ${disputeReason}`,
      )
      this.eventEmitter.emit('payment.disputed', {
        paymentId: payment.id,
        orderId: payment.order.id,
        orderNumber: payment.order.orderNumber,
        amount: Number(payment.amount),
        reason: `FALLBACK: ${disputeReason}`,
        correlationId,
      })
      return
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: payment.order.id },
        data: { status: 'disputed' as any },
      })

      await tx.orderStatusHistory.create({
        data: {
          orderId: payment.order.id,
          fromStatus: payment.order.status as any,
          toStatus: 'disputed',
          source: 'payment_webhook',
          notes: `Dispute: ${disputeReason}`,
          createdBy: 'system',
        },
      })
    })

    // Alert admins via the notification system (SSE + browser push + email)
    this.logger.error(
      `[${correlationId}] DISPUTE on order ${payment.order.orderNumber} | payment=${payment.id} | reason=${disputeReason}`,
    )
    this.eventEmitter.emit('payment.disputed', {
      paymentId: payment.id,
      orderId: payment.order.id,
      orderNumber: payment.order.orderNumber,
      amount: Number(payment.amount),
      reason: disputeReason,
      correlationId,
    })
  }

  // ── REFUND ─────────────────────────────────────────────────

  async createRefund(dto: CreateRefundDto, performedBy: string, correlationId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: dto.paymentId },
      include: { order: true, refunds: true },
    })

    if (!payment) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'PaymentNotFound',
        message: { de: 'Zahlung nicht gefunden.', en: 'Payment not found.', ar: 'الدفع غير موجود.' },
      })
    }

    if (payment.status !== 'captured') {
      throw new BadRequestException({
        statusCode: 400,
        error: 'PaymentNotCaptured',
        message: {
          de: 'Erstattung nur für erfasste Zahlungen möglich.',
          en: 'Refund only possible for captured payments.',
          ar: 'الاسترداد ممكن فقط للمدفوعات المحصلة.',
        },
      })
    }

    // Check total refunded amount
    const totalRefunded = payment.refunds
      .filter((r) => r.status !== 'FAILED')
      .reduce((sum, r) => sum + Number(r.amount), 0)
    const maxRefundable = Math.round(Number(payment.amount) * 100)
    if (totalRefunded * 100 + dto.amount > maxRefundable) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'RefundExceedsPayment',
        message: {
          de: 'Erstattungsbetrag übersteigt den Zahlungsbetrag.',
          en: 'Refund amount exceeds payment amount.',
          ar: 'مبلغ الاسترداد يتجاوز مبلغ الدفع.',
        },
      })
    }

    const provider = this.providerMap.get(payment.provider)
    if (!provider) throw new PaymentFailedException('Provider not configured')

    const idempotencyKey = dto.idempotencyKey ?? crypto.randomUUID()

    // For SumUp: use transaction ID from metadata (different from checkout ID!)
    let refundPaymentId = payment.providerPaymentId!
    if (payment.provider === 'SUMUP' && payment.metadata) {
      const meta = payment.metadata as Record<string, any>
      if (meta.sumupTransactionId) {
        refundPaymentId = meta.sumupTransactionId
      }
    }

    // Execute refund via provider
    const refundResult = await provider.refund({
      providerPaymentId: refundPaymentId,
      amount: dto.amount,
      reason: dto.reason,
      idempotencyKey,
    })

    // Persist refund
    const refund = await this.prisma.refund.create({
      data: {
        paymentId: payment.id,
        amount: dto.amount / 100, // store as EUR, not cents
        reason: dto.reason,
        status: refundResult.status === 'succeeded' ? 'PROCESSED' : refundResult.status === 'failed' ? 'FAILED' : 'PENDING',
        providerRefundId: refundResult.providerRefundId,
        idempotencyKey,
        processedAt: refundResult.status === 'succeeded' ? new Date() : null,
        createdBy: performedBy,
      },
    })

    // Update payment status
    const isFullRefund = totalRefunded * 100 + dto.amount >= maxRefundable
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: isFullRefund ? 'refunded' : 'partially_refunded',
        refundedAmount: { increment: dto.amount / 100 },
        refundedAt: new Date(),
      },
    })

    // Update order status if full refund
    if (isFullRefund) {
      await this.prisma.order.update({
        where: { id: payment.orderId },
        data: { status: 'refunded' },
      })
    }

    this.logger.log(
      `[${correlationId}] Refund: ${refund.id} | payment=${payment.id} | amount=${dto.amount} cents | ${isFullRefund ? 'FULL' : 'PARTIAL'} | by=${performedBy}`,
    )

    // Auto-generate credit note (Gutschrift)
    try {
      await this.invoiceService.generateCreditNote(payment.orderId, dto.amount / 100)
    } catch (err) {
      this.logger.error(`Credit note generation failed for payment ${payment.id}: ${err}`)
    }

    return refund
  }

  // ── ABORT PENDING ORDER ─────────────────────────────────────
  //
  // Called when the user backs out at a redirect-based payment gateway
  // (PayPal "Abbrechen", Klarna cancel, etc). Cancels the order immediately
  // so it stops cluttering the customer's account and the admin dashboard.
  // Idempotent: if the order is already cancelled or paid, this is a no-op.

  async abortPendingOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payment: true },
    })
    if (!order) return { aborted: false, reason: 'not_found' }

    // Only pending/pending_payment orders can be aborted.
    // If the user already paid or the order is already cancelled, leave it alone.
    if (!['pending', 'pending_payment'].includes(order.status)) {
      return { aborted: false, reason: `order_status_${order.status}` }
    }
    if (order.payment && ['captured', 'authorized'].includes(order.payment.status)) {
      return { aborted: false, reason: 'already_paid' }
    }

    // Release reservations + cancel order in one transaction
    let reservationIds: string[] = []
    try {
      const notes = order.notes ? JSON.parse(order.notes) : {}
      reservationIds = notes.reservationIds ?? []
    } catch (e) {
      this.logger.warn(`abort: failed to parse order.notes for ${order.orderNumber}: ${(e as Error).message}`)
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: 'User aborted payment at gateway',
        },
      })
      if (order.payment) {
        await tx.payment.update({
          where: { orderId },
          data: { status: 'failed', failureReason: 'user_cancelled_at_gateway' },
        })
      }
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: order.status as any,
          toStatus: 'cancelled',
          source: 'user_abort',
          notes: 'Cancelled at payment gateway return',
          createdBy: 'system',
        },
      })
    })

    // Release inventory reservations via event (same path as auto-cancel cron)
    if (reservationIds.length > 0) {
      this.eventEmitter.emit(ORDER_EVENTS.CANCELLED, {
        orderId,
        orderNumber: order.orderNumber,
        correlationId: `abort-${orderId.slice(-8)}`,
        reason: 'user_abort',
        reservationIds,
      })
    }

    this.logger.log(`Order aborted by user at gateway: ${order.orderNumber}`)
    return { aborted: true, orderNumber: order.orderNumber }
  }

  // ── RETRY PAYMENT ───────────────────────────────────────────

  async retryPayment(orderId: string, newMethod?: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { orderId },
      include: { order: { include: { user: { select: { email: true, firstName: true, lastName: true } } } } },
    })

    if (!payment || !['pending', 'failed'].includes(payment.status)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'PaymentNotRetryable',
        message: { de: 'Zahlung kann nicht wiederholt werden.', en: 'Payment cannot be retried.', ar: 'لا يمكن إعادة الدفع.' },
      })
    }

    // Map method to provider name
    const METHOD_TO_PROVIDER: Record<string, string> = {
      stripe_card: 'STRIPE', paypal: 'PAYPAL', sumup: 'SUMUP',
      vorkasse: 'VORKASSE', klarna_pay_now: 'KLARNA', klarna_pay_later: 'KLARNA',
    }

    const method = newMethod || payment.method
    const providerName = METHOD_TO_PROVIDER[method] || payment.provider
    const provider = this.providerMap.get(providerName)
    if (!provider) throw new BadRequestException('Provider not available')

    const amount = Math.round(Number(payment.order.totalAmount) * 100)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    const customerEmail = payment.order.user?.email || payment.order.guestEmail || 'customer@malak-bekleidung.com'
    const customerName = payment.order.user ? `${payment.order.user.firstName} ${payment.order.user.lastName}` : 'Kunde'

    const result = await provider.createPaymentIntent({
      amount,
      currency: payment.order.currency ?? 'EUR',
      orderId,
      method,
      customerEmail,
      customerName,
      metadata: {
        orderNumber: payment.order.orderNumber,
        returnUrl: `${appUrl}/checkout/confirmation?order=${payment.order.orderNumber}&orderId=${orderId}&method=${method}`,
        retry: 'true',
      },
      idempotencyKey: `retry-${orderId}-${Date.now()}`,
    })

    // Update payment with new provider + method
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        provider: providerName as any,
        method: method as any,
        providerPaymentId: result.providerPaymentId,
        providerClientSecret: result.clientSecret,
        status: 'pending',
        failureReason: null,
      },
    })

    this.logger.log(`Payment retry: order=${payment.order.orderNumber} method=${method} provider=${providerName}`)

    // For Vorkasse: include bank details in response
    let bankDetails: any = undefined
    if (providerName === 'VORKASSE') {
      const vorkasseProvider = this.providerMap.get('VORKASSE') as any
      if (vorkasseProvider?.getBankDetails) {
        bankDetails = await vorkasseProvider.getBankDetails()
      }
    }

    return {
      redirectUrl: result.redirectUrl,
      clientSecret: result.clientSecret,
      method,
      bankDetails,
    }
  }

  // ── Helpers ────────────────────────────────────────────────

  getProvider(name: string): IPaymentProvider | undefined {
    return this.providerMap.get(name)
  }

  async getPaymentToggles(): Promise<Record<string, boolean>> {
    const settings = await this.prisma.shopSetting.findMany({
      where: { key: { in: ['stripeEnabled', 'klarnaEnabled', 'paypalEnabled', 'sumup_enabled', 'vorkasse_enabled'] } },
    })
    const map = Object.fromEntries(settings.map(s => [s.key, s.value]))
    return {
      stripe: map.stripeEnabled !== 'false',
      paypal: map.paypalEnabled !== 'false',
      klarna: map.klarnaEnabled !== 'false',
      sumup: map.sumup_enabled !== 'false',
      vorkasse: map.vorkasse_enabled !== 'false',
    }
  }
}
