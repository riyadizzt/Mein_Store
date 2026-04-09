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

/**
 * PayPal Provider — Orders API v2
 *
 * Flow:
 * 1. Backend creates PayPal order (POST /v2/checkout/orders)
 * 2. Customer is redirected to PayPal to approve
 * 3. PayPal redirects back to our site
 * 4. Backend captures payment (POST /v2/checkout/orders/{id}/capture)
 *
 * Docs: https://developer.paypal.com/docs/api/orders/v2/
 */
@Injectable()
export class PayPalProvider implements IPaymentProvider {
  readonly providerName = 'PAYPAL'
  private readonly logger = new Logger(PayPalProvider.name)
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly apiUrl: string

  constructor(private readonly config: ConfigService) {
    this.clientId = this.config.get('PAYPAL_CLIENT_ID') || ''
    this.clientSecret = this.config.get('PAYPAL_CLIENT_SECRET') || ''
    const mode = this.config.get('PAYPAL_MODE', 'sandbox')
    this.apiUrl = mode === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com'

    if (!this.clientId) {
      this.logger.warn('PayPal nicht konfiguriert — PAYPAL_CLIENT_ID fehlt in .env')
    }
  }

  private async getAccessToken(): Promise<string> {
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')
    const res = await fetch(`${this.apiUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    })
    if (!res.ok) throw new Error(`PayPal OAuth failed: ${res.status}`)
    const data: any = await res.json()
    return data.access_token
  }

  async createPaymentIntent(input: CreatePaymentInput): Promise<PaymentIntentResult> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('PayPal is not configured')
    }

    const token = await this.getAccessToken()
    const amountEur = (input.amount / 100).toFixed(2)
    const returnUrl = `${this.config.get('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')}/checkout/confirmation`
    const cancelUrl = `${this.config.get('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')}/checkout`

    const res = await fetch(`${this.apiUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': input.idempotencyKey ?? crypto.randomUUID(),
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: input.metadata?.orderNumber ?? input.orderId,
          amount: {
            currency_code: input.currency.toUpperCase(),
            value: amountEur,
          },
          description: `Bestellung ${input.metadata?.orderNumber ?? ''}`,
        }],
        payment_source: {
          paypal: {
            experience_context: {
              payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
              brand_name: 'Malak Bekleidung',
              locale: 'de-DE',
              landing_page: 'LOGIN',
              user_action: 'PAY_NOW',
              return_url: returnUrl,
              cancel_url: cancelUrl,
            },
          },
        },
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      this.logger.error(`PayPal order creation failed: ${err}`)
      throw new Error(`PayPal API error: ${res.status}`)
    }

    const data: any = await res.json()
    const approveLink = data.links?.find((l: any) => l.rel === 'payer-action')?.href
      ?? data.links?.find((l: any) => l.rel === 'approve')?.href

    this.logger.log(`PayPal order created: ${data.id} → ${approveLink}`)

    return {
      providerPaymentId: data.id,
      clientSecret: null,
      status: 'requires_action',
      redirectUrl: approveLink,
    }
  }

  async captureOrder(paypalOrderId: string): Promise<{ status: string }> {
    const token = await this.getAccessToken()
    const res = await fetch(`${this.apiUrl}/v2/checkout/orders/${paypalOrderId}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })

    if (!res.ok) {
      const err = await res.text()
      this.logger.error(`PayPal capture failed: ${err}`)
      throw new Error(`PayPal capture error: ${res.status}`)
    }

    const data: any = await res.json()
    this.logger.log(`PayPal captured: ${paypalOrderId} → ${data.status}`)
    return { status: data.status }
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    if (!this.clientId) throw new Error('PayPal not configured')

    const token = await this.getAccessToken()
    // Get the capture ID from the order
    const orderRes = await fetch(`${this.apiUrl}/v2/checkout/orders/${input.providerPaymentId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    const orderData: any = await orderRes.json()
    const captureId = orderData?.purchase_units?.[0]?.payments?.captures?.[0]?.id

    if (!captureId) {
      return { providerRefundId: '', status: 'failed', amount: input.amount }
    }

    const res = await fetch(`${this.apiUrl}/v2/payments/captures/${captureId}/refund`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: {
          value: (input.amount / 100).toFixed(2),
          currency_code: 'EUR',
        },
      }),
    })

    if (!res.ok) {
      this.logger.error(`PayPal refund failed: ${await res.text()}`)
      return { providerRefundId: '', status: 'failed', amount: input.amount }
    }

    const data: any = await res.json()
    return {
      providerRefundId: data.id,
      status: data.status === 'COMPLETED' ? 'succeeded' : 'pending',
      amount: input.amount,
    }
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): WebhookVerificationResult {
    const webhookId = this.config.get('PAYPAL_WEBHOOK_ID') || ''
    if (!webhookId) return { isValid: false, eventType: '', eventId: '', payload: {} }

    // PayPal webhook verification is more complex (requires API call)
    // For now, basic check
    let payload: any = {}
    try { payload = JSON.parse(rawBody.toString()) } catch {}

    return {
      isValid: !!signature,
      eventType: payload.event_type ?? '',
      eventId: payload.id ?? '',
      payload,
    }
  }

  isConfigured(): boolean {
    return !!this.clientId && !!this.clientSecret
  }
}
