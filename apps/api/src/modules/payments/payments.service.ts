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

    // 6. Persist payment record
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
        providerClientSecret: intentResult.clientSecret,
        idempotencyKey,
        failureReason: null,
      },
    })

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

  // ── HANDLE PAYMENT SUCCESS (called from webhook) ───────────

  async handlePaymentSuccess(
    providerPaymentId: string,
    providerName: string,
    correlationId: string,
  ): Promise<void> {
    const payment = await this.prisma.payment.findFirst({
      where: { providerPaymentId },
      include: { order: { select: { id: true, orderNumber: true, status: true, notes: true } } },
    })

    if (!payment) {
      this.logger.warn(`Payment not found for provider ID: ${providerPaymentId}`)
      return
    }

    if (payment.status === 'captured') {
      this.logger.debug(`Payment ${payment.id} already captured — skipping`)
      return
    }

    // DB transaction: Payment→CAPTURED, Order→CONFIRMED, Inventory→SOLD
    await this.prisma.$transaction(async (tx) => {
      // 1. Payment → captured
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'captured', paidAt: new Date() },
      })

      // 2. Order → confirmed (only if pending_payment)
      if (['pending', 'pending_payment'].includes(payment.order.status)) {
        await tx.order.update({
          where: { id: payment.order.id },
          data: { status: 'confirmed' },
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
      }
    })

    // 3. Inventory: confirm reservation → deduct stock (via event)
    const notes = payment.order.notes ? JSON.parse(payment.order.notes) : {}
    const reservationIds: string[] = notes.reservationIds ?? []

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
    const payment = await this.prisma.payment.findFirst({
      where: { providerPaymentId },
      include: { order: { select: { id: true, orderNumber: true, status: true, notes: true } } },
    })

    if (!payment) return

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
    const notes = payment.order.notes ? JSON.parse(payment.order.notes) : {}
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
    const payment = await this.prisma.payment.findFirst({
      where: { providerPaymentId },
      include: { order: { select: { id: true, orderNumber: true, status: true } } },
    })

    if (!payment) return

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

    // TODO: Send admin alert email via EmailService
    this.logger.error(
      `[${correlationId}] DISPUTE on order ${payment.order.orderNumber} | payment=${payment.id} | reason=${disputeReason}`,
    )
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

    // Execute refund via provider
    const refundResult = await provider.refund({
      providerPaymentId: payment.providerPaymentId!,
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

  // ── Helpers ────────────────────────────────────────────────

  getProvider(name: string): IPaymentProvider | undefined {
    return this.providerMap.get(name)
  }
}
