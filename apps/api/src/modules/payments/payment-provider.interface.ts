// ── Payment Provider Interface (Strategy Pattern) ─────────────
// Jeder Provider (Stripe, Klarna, PayPal) implementiert dieses Interface.
// Der PaymentsService wählt den Provider basierend auf der Zahlungsart des Kunden.

export interface CreatePaymentInput {
  orderId: string
  amount: number          // in cents (Stripe) or smallest unit
  currency: string        // EUR
  method: string          // stripe_card, klarna_pay_now, etc.
  customerEmail: string
  customerName: string
  metadata?: Record<string, string>
  idempotencyKey?: string
}

export interface PaymentIntentResult {
  providerPaymentId: string
  clientSecret: string | null   // For frontend confirmation (Stripe, Klarna)
  status: 'requires_action' | 'requires_confirmation' | 'succeeded' | 'pending'
  redirectUrl?: string          // For redirect-based flows (Klarna, PayPal)
}

export interface RefundInput {
  providerPaymentId: string
  amount: number          // in cents — partial or full
  reason?: string
  idempotencyKey?: string
}

export interface RefundResult {
  providerRefundId: string
  status: 'pending' | 'succeeded' | 'failed'
  amount: number
}

export interface WebhookVerificationResult {
  isValid: boolean
  eventType: string
  eventId: string
  payload: Record<string, unknown>
}

export interface IPaymentProvider {
  readonly providerName: string

  createPaymentIntent(input: CreatePaymentInput): Promise<PaymentIntentResult>
  refund(input: RefundInput): Promise<RefundResult>
  verifyWebhookSignature(rawBody: Buffer, signature: string): WebhookVerificationResult
  cancelPaymentIntent?(providerPaymentId: string): Promise<void>
}

export const PAYMENT_PROVIDERS = 'PAYMENT_PROVIDERS'
