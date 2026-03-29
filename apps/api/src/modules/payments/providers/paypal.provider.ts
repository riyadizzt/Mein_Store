import { Injectable, Logger } from '@nestjs/common'
import {
  IPaymentProvider,
  CreatePaymentInput,
  PaymentIntentResult,
  RefundInput,
  RefundResult,
  WebhookVerificationResult,
} from '../payment-provider.interface'

/**
 * PayPal Provider — STUB
 *
 * Interface bereit. Implementierung erfolgt in einer späteren Phase.
 * Target: PayPal Orders API v2 (https://developer.paypal.com/docs/api/orders/v2/)
 */
@Injectable()
export class PayPalProvider implements IPaymentProvider {
  readonly providerName = 'PAYPAL'
  private readonly logger = new Logger(PayPalProvider.name)

  async createPaymentIntent(_input: CreatePaymentInput): Promise<PaymentIntentResult> {
    this.logger.warn('PayPal provider is not yet implemented — stub only')
    throw new Error('PayPal integration not yet available. Please use Stripe or Klarna.')
  }

  async refund(_input: RefundInput): Promise<RefundResult> {
    throw new Error('PayPal refund not yet implemented.')
  }

  verifyWebhookSignature(_rawBody: Buffer, _signature: string): WebhookVerificationResult {
    return { isValid: false, eventType: '', eventId: '', payload: {} }
  }
}
