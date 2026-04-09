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
 * SumUp Online Payments Provider
 *
 * Uses SumUp Checkout API to create payment sessions.
 * Supports: Card, Apple Pay, Google Pay
 * Docs: https://developer.sumup.com/online-payments
 */
@Injectable()
export class SumUpProvider implements IPaymentProvider {
  readonly providerName = 'SUMUP'
  private readonly logger = new Logger(SumUpProvider.name)
  private readonly apiKey: string
  private readonly merchantCode: string
  private readonly apiUrl = 'https://api.sumup.com'

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get('SUMUP_API_KEY') || ''
    this.merchantCode = this.config.get('SUMUP_MERCHANT_CODE') || ''

    if (!this.apiKey) {
      this.logger.warn('SumUp nicht konfiguriert — SUMUP_API_KEY fehlt in .env')
    }
  }

  async createPaymentIntent(input: CreatePaymentInput): Promise<PaymentIntentResult> {
    if (!this.apiKey || !this.merchantCode) {
      throw new Error('SumUp is not configured (missing API key or merchant code)')
    }

    const amountEur = input.amount / 100 // Convert cents to EUR
    const checkoutRef = input.metadata?.orderNumber ?? `ORD-${input.orderId.slice(0, 8)}`
    const returnUrl = `${this.config.get('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')}/checkout/confirmation`

    const response = await fetch(`${this.apiUrl}/v0.1/checkouts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        checkout_reference: checkoutRef,
        amount: amountEur,
        currency: input.currency.toUpperCase(),
        pay_to_email: this.merchantCode,
        description: `Bestellung ${checkoutRef}`,
        return_url: returnUrl,
        merchant_code: this.merchantCode,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      this.logger.error(`SumUp checkout creation failed: ${err}`)
      throw new Error(`SumUp API error: ${response.status}`)
    }

    const data: any = await response.json()
    this.logger.log(`SumUp checkout created: ${data.id} for ${checkoutRef}`)

    return {
      providerPaymentId: data.id,
      clientSecret: data.id, // Used as checkout_id in frontend
      status: 'requires_action',
      redirectUrl: undefined, // SumUp uses embedded widget, not redirect
    }
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    if (!this.apiKey) throw new Error('SumUp not configured')

    const response = await fetch(`${this.apiUrl}/v0.1/me/refund/${input.providerPaymentId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: input.amount / 100,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      this.logger.error(`SumUp refund failed: ${err}`)
      return {
        providerRefundId: `SUMUP-REFUND-FAILED`,
        status: 'failed',
        amount: input.amount,
      }
    }

    return {
      providerRefundId: `SUMUP-REFUND-${crypto.randomUUID().slice(0, 8)}`,
      status: 'succeeded',
      amount: input.amount,
    }
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): WebhookVerificationResult {
    const secret = this.config.get('SUMUP_WEBHOOK_SECRET') || ''
    if (!secret) return { isValid: false, eventType: '', eventId: '', payload: {} }

    const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    const isValid = hmac === signature

    let payload: any = {}
    try { payload = JSON.parse(rawBody.toString()) } catch {}

    return {
      isValid,
      eventType: payload.event_type ?? '',
      eventId: payload.id ?? '',
      payload,
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey && !!this.merchantCode
  }
}
