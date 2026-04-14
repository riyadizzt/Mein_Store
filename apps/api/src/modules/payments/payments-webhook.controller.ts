import {
  Controller,
  Post,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  RawBodyRequest,
} from '@nestjs/common'
import { Request } from 'express'
import { PrismaService } from '../../prisma/prisma.service'
import { PaymentsService } from './payments.service'
import { StripeProvider } from './providers/stripe.provider'
import { KlarnaProvider } from './providers/klarna.provider'

@Controller('payments/webhooks')
export class PaymentsWebhookController {
  private readonly logger = new Logger(PaymentsWebhookController.name)

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly prisma: PrismaService,
    private readonly stripeProvider: StripeProvider,
    private readonly klarnaProvider: KlarnaProvider,
  ) {}

  // ── Stripe Webhook ─────────────────────────────────────────

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  async stripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!req.rawBody) {
      this.logger.error('Stripe webhook: missing raw body')
      return { received: false }
    }

    // 1. Verify signature — MANDATORY
    const verification = this.stripeProvider.verifyWebhookSignature(req.rawBody, signature)
    if (!verification.isValid) {
      this.logger.error('Stripe webhook: INVALID SIGNATURE — rejected')
      return { received: false }
    }

    // 2. Idempotency: check if already processed
    const existing = await this.prisma.webhookEvent.findUnique({
      where: { providerEventId: verification.eventId },
    })
    if (existing?.processed) {
      this.logger.debug(`Stripe webhook: already processed ${verification.eventId}`)
      return { received: true }
    }

    // 3. Record webhook event
    const webhookRecord = await this.prisma.webhookEvent.upsert({
      where: { providerEventId: verification.eventId },
      create: {
        provider: 'STRIPE',
        eventType: verification.eventType,
        providerEventId: verification.eventId,
        payload: verification.payload as any,
      },
      update: {},
    })

    const correlationId = `wh-stripe-${verification.eventId.slice(-8)}`

    // 4. Process by event type
    try {
      const pi = verification.payload as Record<string, unknown>
      const paymentIntentId = (pi.id as string) ?? ''

      switch (verification.eventType) {
        case 'payment_intent.succeeded':
          await this.paymentsService.handlePaymentSuccess(paymentIntentId, 'STRIPE', correlationId)
          break

        case 'payment_intent.payment_failed': {
          const lastError = (pi.last_payment_error as Record<string, unknown>)
          const reason = (lastError?.message as string) ?? 'Payment failed'
          await this.paymentsService.handlePaymentFailure(paymentIntentId, reason, correlationId)
          break
        }

        case 'charge.refunded':
          this.logger.log(`Stripe charge.refunded: ${pi.id} — handled via API, webhook is confirmation`)
          break

        case 'charge.dispute.created': {
          const disputePi = (pi.payment_intent as string) ?? ''
          const disputeReason = (pi.reason as string) ?? 'unknown'
          await this.paymentsService.handleDispute(disputePi, disputeReason, correlationId)
          break
        }

        default:
          this.logger.debug(`Stripe webhook: unhandled event ${verification.eventType}`)
      }

      // 5. Mark as processed
      await this.prisma.webhookEvent.update({
        where: { id: webhookRecord.id },
        data: { processed: true, processedAt: new Date() },
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      await this.prisma.webhookEvent.update({
        where: { id: webhookRecord.id },
        data: { error: msg },
      })
      this.logger.error(`Stripe webhook processing error: ${verification.eventType} — ${msg}`)
    }

    return { received: true }
  }

  // ── Klarna Webhook ─────────────────────────────────────────

  @Post('klarna')
  @HttpCode(HttpStatus.OK)
  async klarnaWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('klarna-signature') signature: string,
  ) {
    if (!req.rawBody) {
      this.logger.error('Klarna webhook: missing raw body')
      return { received: false }
    }

    const verification = this.klarnaProvider.verifyWebhookSignature(req.rawBody, signature ?? '')
    if (!verification.isValid) {
      this.logger.error('Klarna webhook: invalid payload')
      return { received: false }
    }

    // Idempotency
    const existing = await this.prisma.webhookEvent.findUnique({
      where: { providerEventId: verification.eventId },
    })
    if (existing?.processed) return { received: true }

    const webhookRecord = await this.prisma.webhookEvent.upsert({
      where: { providerEventId: verification.eventId },
      create: {
        provider: 'KLARNA',
        eventType: verification.eventType,
        providerEventId: verification.eventId,
        payload: verification.payload as any,
      },
      update: {},
    })

    try {
      const payload = verification.payload as Record<string, unknown>
      const _correlationId = `wh-klarna-${verification.eventId.slice(-8)}`

      switch (verification.eventType) {
        case 'order.approved':
          this.logger.log(`[${_correlationId}] Klarna order approved: ${payload.order_id}`)
          break

        case 'order.denied':
        case 'order.cancelled':
          this.logger.log(`[${_correlationId}] Klarna order ${verification.eventType}: ${payload.order_id}`)
          break

        default:
          this.logger.debug(`[${_correlationId}] Klarna webhook: unhandled event ${verification.eventType}`)
      }

      await this.prisma.webhookEvent.update({
        where: { id: webhookRecord.id },
        data: { processed: true, processedAt: new Date() },
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      await this.prisma.webhookEvent.update({
        where: { id: webhookRecord.id },
        data: { error: msg },
      })
      this.logger.error(`Klarna webhook processing error: ${msg}`)
    }

    return { received: true }
  }
}
