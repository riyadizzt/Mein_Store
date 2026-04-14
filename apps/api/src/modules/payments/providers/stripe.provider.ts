import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Stripe from 'stripe'
import {
  IPaymentProvider,
  CreatePaymentInput,
  PaymentIntentResult,
  RefundInput,
  RefundResult,
  WebhookVerificationResult,
} from '../payment-provider.interface'

@Injectable()
export class StripeProvider implements IPaymentProvider {
  readonly providerName = 'STRIPE'
  private readonly logger = new Logger(StripeProvider.name)
  private readonly stripe: Stripe
  private readonly webhookSecret: string

  constructor(private readonly config: ConfigService) {
    this.stripe = new Stripe(this.config.getOrThrow<string>('STRIPE_SECRET_KEY'))
    this.webhookSecret = this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET')
  }

  async createPaymentIntent(input: CreatePaymentInput): Promise<PaymentIntentResult> {
    this.logger.log(`Creating Stripe PaymentIntent: ${input.orderId} | €${(input.amount / 100).toFixed(2)}`)

    const params: Stripe.PaymentIntentCreateParams = {
      amount: input.amount,
      currency: input.currency.toLowerCase(),
      metadata: {
        orderId: input.orderId,
        ...input.metadata,
      },
      receipt_email: input.customerEmail,
      description: `Malak Bekleidung — Bestellung ${input.orderId}`,
      // SCA/3D Secure automatisch für EU-Karten
      automatic_payment_methods: { enabled: true },
    }

    const intent = await this.stripe.paymentIntents.create(params, {
      idempotencyKey: input.idempotencyKey,
    })

    this.logger.log(`Stripe PaymentIntent created: ${intent.id} | status=${intent.status}`)

    return {
      providerPaymentId: intent.id,
      clientSecret: intent.client_secret,
      status: this.mapStripeStatus(intent.status),
    }
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    this.logger.log(`Creating Stripe refund: ${input.providerPaymentId} | ${input.amount} cents`)

    const refund = await this.stripe.refunds.create(
      {
        payment_intent: input.providerPaymentId,
        amount: input.amount,
        reason: 'requested_by_customer',
        metadata: input.reason ? { internal_reason: input.reason.slice(0, 200) } : undefined,
      },
      { idempotencyKey: input.idempotencyKey },
    )

    return {
      providerRefundId: refund.id,
      status: refund.status === 'succeeded' ? 'succeeded' : refund.status === 'failed' ? 'failed' : 'pending',
      amount: refund.amount,
    }
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): WebhookVerificationResult {
    try {
      const event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      )

      return {
        isValid: true,
        eventType: event.type,
        eventId: event.id,
        payload: event.data.object as unknown as Record<string, unknown>,
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(`Stripe webhook signature verification failed: ${msg}`)
      return {
        isValid: false,
        eventType: '',
        eventId: '',
        payload: {},
      }
    }
  }

  async cancelPaymentIntent(providerPaymentId: string): Promise<void> {
    await this.stripe.paymentIntents.cancel(providerPaymentId)
    this.logger.log(`Stripe PaymentIntent cancelled: ${providerPaymentId}`)
  }

  private mapStripeStatus(status: string): PaymentIntentResult['status'] {
    switch (status) {
      case 'requires_action':
      case 'requires_source_action':
        return 'requires_action'
      case 'requires_confirmation':
      case 'requires_source':
      case 'requires_payment_method':
        return 'requires_confirmation'
      case 'succeeded':
        return 'succeeded'
      default:
        return 'pending'
    }
  }
}
