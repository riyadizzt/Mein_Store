import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as crypto from 'crypto'
import {
  IPaymentProvider,
  CreatePaymentInput,
  PaymentIntentResult,
  RefundInput,
  RefundResult,
  WebhookVerificationResult,
} from '../payment-provider.interface'

@Injectable()
export class KlarnaProvider implements IPaymentProvider {
  readonly providerName = 'KLARNA'
  private readonly logger = new Logger(KlarnaProvider.name)
  private readonly apiUrl: string
  private readonly authHeader: string

  constructor(private readonly config: ConfigService) {
    this.apiUrl = this.config.get('KLARNA_API_URL', 'https://api.playground.klarna.com')
    const username = this.config.getOrThrow<string>('KLARNA_USERNAME')
    const password = this.config.getOrThrow<string>('KLARNA_PASSWORD')
    this.authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  }

  async createPaymentIntent(input: CreatePaymentInput): Promise<PaymentIntentResult> {
    this.logger.log(`Creating Klarna session: ${input.orderId} | €${(input.amount / 100).toFixed(2)}`)

    const body = {
      purchase_country: 'DE',
      purchase_currency: input.currency.toUpperCase(),
      locale: 'de-DE',
      order_amount: input.amount,
      order_tax_amount: Math.round(input.amount * 19 / 119), // 19% MwSt herausrechnen
      order_lines: [
        {
          type: 'physical',
          name: `Bestellung ${input.orderId}`,
          quantity: 1,
          unit_price: input.amount,
          tax_rate: 1900, // 19.00%
          total_amount: input.amount,
          total_tax_amount: Math.round(input.amount * 19 / 119),
        },
      ],
      merchant_reference1: input.orderId,
    }

    const response = await fetch(`${this.apiUrl}/payments/v1/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.authHeader,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      this.logger.error(`Klarna session creation failed: ${response.status} ${error}`)
      throw new Error(`Klarna: ${response.status}`)
    }

    const data = await response.json() as {
      session_id: string
      client_token: string
      payment_method_categories: Array<{ identifier: string }>
    }

    this.logger.log(`Klarna session created: ${data.session_id}`)

    return {
      providerPaymentId: data.session_id,
      clientSecret: data.client_token,
      status: 'requires_action',
    }
  }

  /**
   * Authorize Klarna payment after customer approval.
   * Called from frontend with authorization_token.
   */
  async authorizePayment(authorizationToken: string, orderId: string, amount: number): Promise<{ orderId: string }> {
    const body = {
      purchase_country: 'DE',
      purchase_currency: 'EUR',
      order_amount: amount,
      order_tax_amount: Math.round(amount * 19 / 119),
      order_lines: [
        {
          type: 'physical',
          name: `Bestellung ${orderId}`,
          quantity: 1,
          unit_price: amount,
          tax_rate: 1900,
          total_amount: amount,
          total_tax_amount: Math.round(amount * 19 / 119),
        },
      ],
      merchant_reference1: orderId,
    }

    const response = await fetch(
      `${this.apiUrl}/payments/v1/authorizations/${authorizationToken}/order`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: this.authHeader },
        body: JSON.stringify(body),
      },
    )

    if (!response.ok) {
      const error = await response.text()
      this.logger.error(`Klarna authorization failed: ${response.status} ${error}`)
      throw new Error(`Klarna authorization: ${response.status}`)
    }

    const data = await response.json() as { order_id: string }
    this.logger.log(`Klarna order authorized: ${data.order_id}`)
    return { orderId: data.order_id }
  }

  /**
   * Capture Klarna payment — called ONLY on shipment (not on order confirmation).
   */
  async capturePayment(klarnaOrderId: string, amount: number): Promise<void> {
    const response = await fetch(
      `${this.apiUrl}/ordermanagement/v1/orders/${klarnaOrderId}/captures`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: this.authHeader },
        body: JSON.stringify({ captured_amount: amount }),
      },
    )

    if (!response.ok) {
      const error = await response.text()
      this.logger.error(`Klarna capture failed: ${response.status} ${error}`)
      throw new Error(`Klarna capture: ${response.status}`)
    }

    this.logger.log(`Klarna captured: ${klarnaOrderId} | ${amount} cents`)
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    this.logger.log(`Creating Klarna refund: ${input.providerPaymentId} | ${input.amount} cents`)

    const response = await fetch(
      `${this.apiUrl}/ordermanagement/v1/orders/${input.providerPaymentId}/refunds`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: this.authHeader },
        body: JSON.stringify({
          refunded_amount: input.amount,
          description: input.reason ?? 'Customer refund',
        }),
      },
    )

    if (!response.ok) {
      const error = await response.text()
      this.logger.error(`Klarna refund failed: ${response.status} ${error}`)
      return { providerRefundId: '', status: 'failed', amount: input.amount }
    }

    const data = await response.json() as { refund_id: string }
    return { providerRefundId: data.refund_id ?? 'klarna-refund', status: 'succeeded', amount: input.amount }
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): WebhookVerificationResult {
    // Klarna HMAC-SHA256 webhook signature verification
    const webhookSecret = this.config.get('KLARNA_WEBHOOK_SECRET', '')

    if (!webhookSecret) {
      this.logger.error('KLARNA_WEBHOOK_SECRET not configured — rejecting webhook')
      return { isValid: false, eventType: '', eventId: '', payload: {} }
    }

    try {
      // Verify HMAC-SHA256 signature
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('base64')

      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      )

      if (!isValid) {
        this.logger.error('Klarna webhook signature mismatch — rejecting')
        return { isValid: false, eventType: '', eventId: '', payload: {} }
      }

      const body = JSON.parse(rawBody.toString())
      return {
        isValid: true,
        eventType: body.event_type ?? '',
        eventId: body.event_id ?? crypto.randomUUID(),
        payload: body,
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(`Klarna webhook verification error: ${msg}`)
      return { isValid: false, eventType: '', eventId: '', payload: {} }
    }
  }
}
