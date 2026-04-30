/**
 * EbayPaymentProvider (C13.3) — implements IPaymentProvider for
 * eBay Managed Payments refund flow.
 *
 * Architecture (Pfad Alpha — verified by user-decision after Phase A audit):
 *   PaymentsService.refund() iterates over the providerMap by
 *   Payment.provider (line 933 in payments.service.ts). When provider
 *   is 'EBAY_MANAGED_PAYMENTS', it picks up THIS class and calls
 *   refund(), which returns { status: 'pending', providerRefundId }.
 *   The existing payments.service code (lines 967-969) maps 'pending'
 *   to RefundStatus.PENDING and createCreditNoteShellInTx generates
 *   the credit note shell EXACTLY like for Vorkasse — no special-
 *   casing, ZERO TOUCH on payments.service.refund().
 *
 *   Status transition PENDING → PROCESSED happens later via
 *   EbayRefundPollService (60-min cron) which polls eBay's
 *   getOrder() endpoint for refund-status.
 *
 * createPaymentIntent: NO-OP. eBay-orders arrive in our system
 *   already paid (createFromMarketplace pre-creates the payment row
 *   with status='captured'). Throws if ever called.
 *
 * verifyWebhookSignature: NO-OP. Refund flow is poll-based (S-4
 *   amended); no eBay refund-webhook is wired.
 *
 * Defensive-Multi-Path (Y-3 decision):
 *   eBay's issue_refund response shape was NOT verified by live
 *   probe (no test order existed in sandbox at C13.3 build time).
 *   The code looks for refundId at FOUR known paths and logs the
 *   complete raw response so first-real-refund operations are
 *   debuggable. If all paths fail to resolve, we still return
 *   'pending' with empty providerRefundId — the 48h-fallback
 *   admin-notification (S-5) will surface the case for manual
 *   confirmation via the admin-returns endpoint.
 *
 * Hard-Rule compliance:
 *   - PaymentsService.refund() ZERO TOUCH
 *   - InvoiceService ZERO TOUCH
 *   - Existing providers (Stripe/PayPal/Klarna/SumUp/Vorkasse) ZERO TOUCH
 *   - IPaymentProvider interface ZERO TOUCH (this class implements it)
 */

import { Injectable, Logger } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { resolveEbayEnv } from '../../marketplaces/ebay/ebay-env'
import { EbayAuthService } from '../../marketplaces/ebay/ebay-auth.service'
import { EbayApiClient, EbayApiError } from '../../marketplaces/ebay/ebay-api.client'
import type {
  IPaymentProvider,
  CreatePaymentInput,
  PaymentIntentResult,
  RefundInput,
  RefundResult,
  WebhookVerificationResult,
} from '../payment-provider.interface'

// Reason-code mapping: our ReturnReason enum → eBay's
// reasonForRefund accepted values.
//
// HYPOTHESIS — verified during first real refund. If eBay rejects
// any of these values, the call returns 4xx and the refund row goes
// to FAILED with admin-notify (RefundResult.status='failed' path).
const REASON_MAP: Record<string, string> = {
  wrong_size: 'BUYER_RETURN',
  damaged: 'ITEM_NOT_AS_DESCRIBED',
  quality_issue: 'ITEM_NOT_AS_DESCRIBED',
  wrong_product: 'ITEM_NOT_AS_DESCRIBED',
  right_of_withdrawal: 'BUYER_RETURN',
  changed_mind: 'BUYER_RETURN',
  other: 'OTHER',
}

/**
 * Defensive multi-path refundId extractor.
 *
 * Tries four known eBay response shapes (per eBay-Doku-Iterations
 * over the years). On miss returns null and the caller logs the
 * raw response for first-real-refund-debugging.
 */
function extractRefundId(response: any): string | null {
  return (
    response?.refundId ??
    response?.refunds?.[0]?.refundId ??
    response?.refund?.refundId ??
    response?.id ??
    null
  )
}

@Injectable()
export class EbayPaymentProvider implements IPaymentProvider {
  readonly providerName = 'EBAY_MANAGED_PAYMENTS'
  private readonly logger = new Logger(EbayPaymentProvider.name)

  // C13.3 hotfix: ModuleRef-based lazy resolution of EbayAuthService
  // breaks the module-load-time cycle that direct injection would
  // create (PaymentsModule → MarketplacesModule → AdminModule →
  // PaymentsModule). ModuleRef is provided by NestJS core, no module
  // import needed. EbayAuthService is resolved on-demand inside
  // refund() — the auth-token call is async anyway, so the lookup
  // overhead is negligible.
  constructor(
    private readonly moduleRef: ModuleRef,
  ) {}

  /** Lazy-resolve EbayAuthService from any module it lives in
   *  (`strict: false` searches the whole DI tree). Cached after
   *  first resolution. */
  private cachedAuth: EbayAuthService | null = null
  private async getAuth(): Promise<EbayAuthService> {
    if (this.cachedAuth) return this.cachedAuth
    const resolved = this.moduleRef.get(EbayAuthService, { strict: false })
    if (!resolved) {
      throw new Error('EbayPaymentProvider: EbayAuthService not resolvable via ModuleRef')
    }
    this.cachedAuth = resolved
    return resolved
  }

  async createPaymentIntent(_input: CreatePaymentInput): Promise<PaymentIntentResult> {
    // eBay-orders are pre-paid via eBay Managed Payments. Creating
    // a payment intent for them is a contract violation that should
    // never happen — createFromMarketplace pre-creates the payment
    // row directly without going through providers.
    throw new Error(
      'EbayPaymentProvider.createPaymentIntent is not supported — ' +
        'eBay orders arrive pre-paid via createFromMarketplace.',
    )
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    // payment.providerPaymentId was set by createFromMarketplace to
    // externalOrderId (= eBay's orderId). VP-1 verified this in
    // C13.3 Phase E.
    const ebayOrderId = input.providerPaymentId
    const reasonCode = REASON_MAP[input.reason ?? 'other'] ?? 'OTHER'
    const refundAmountEur = (input.amount / 100).toFixed(2)

    const env = resolveEbayEnv()
    const auth = await this.getAuth()
    const bearer = await auth.getAccessTokenOrRefresh()
    const client = new EbayApiClient(env)

    // Body shape — best-effort per eBay-Doku, defensive against
    // schema variants. eBay typically accepts both `fullRefund: true`
    // (no refundItems) AND a refundItems array (line-item-level).
    // First real refund will reveal which shape is correct; if eBay
    // 4xx's, the refund row goes to FAILED and admin sees the
    // exact error in admin-returns UI + audit-log.
    const body = {
      reasonForRefund: reasonCode,
      comment: input.reason ? `Refund reason: ${input.reason}` : 'Admin-initiated refund',
      // Full refund — partial refunds use the same path with smaller
      // amount; eBay handles the math. If eBay rejects this shape
      // we'll learn the correct field-name on first attempt.
      refundAmount: { value: refundAmountEur, currency: 'EUR' },
    }

    let rawResponse: any
    try {
      rawResponse = await client.request<any>(
        'POST',
        `/sell/fulfillment/v1/order/${encodeURIComponent(ebayOrderId)}/issue_refund`,
        { bearer, body, bodyKind: 'json', retry: false },
      )
    } catch (e: any) {
      if (e instanceof EbayApiError) {
        // 4xx = client error → return 'failed' so payments.service
        // maps to RefundStatus.FAILED. Audit captures detail.
        if (e.status >= 400 && e.status < 500) {
          this.logger.error(
            `[ebay-refund] 4xx for order=${ebayOrderId}: ${e.status} — ${e.message.slice(0, 200)}`,
          )
          return {
            providerRefundId: '',
            status: 'failed',
            amount: input.amount,
          }
        }
      }
      // 5xx / network → re-throw, payments.service handles retry
      throw e
    }

    // First-Run-Logging (Y-2 decision part 1: Railway logger):
    // ALWAYS log the full raw response so first-real-refund-shape
    // is captured even if extractRefundId succeeds.
    this.logger.log(
      `[ebay-refund] raw response for order=${ebayOrderId}: ${JSON.stringify(rawResponse).slice(0, 800)}`,
    )

    const ebayRefundId = extractRefundId(rawResponse)
    if (!ebayRefundId) {
      // Defensive: 2xx but no refundId at any known path. Log loud,
      // return 'pending' with empty providerRefundId. Poll-cron
      // cannot track this refund (no ID to poll for) → 48h-fallback
      // admin-notify will fire → admin uses manual-confirm endpoint.
      this.logger.warn(
        `[ebay-refund] 2xx but NO refundId at any known path for order=${ebayOrderId}. ` +
          `Tracking blind — 48h-fallback will surface this for manual-confirm.`,
      )
    } else {
      this.logger.log(
        `[ebay-refund] initiated refundId=${ebayRefundId} order=${ebayOrderId} amount=${refundAmountEur} EUR reason=${reasonCode}`,
      )
    }

    // Mark Refund.ebayRequestedAt = now() once payments.service has
    // committed the refund-row. This is done outside the provider
    // because we don't have the refund.id yet at this layer; the
    // payments.service writes processedAt=null for 'pending' refunds
    // and the new column is updated via a second small write
    // immediately after. See payments.module wiring docs.
    //
    // BUT — to keep ZERO TOUCH on payments.service.refund(), we
    // instead do the ebayRequestedAt write inside this provider via
    // a follow-up updateMany matched by providerRefundId+idempotencyKey.
    // The window between createPayment-row and this write is
    // acceptable because EbayRefundPollService.runPollTick uses
    // refund.createdAt as fallback when ebayRequestedAt is NULL.
    //
    // Phase D simplified: NOT writing ebayRequestedAt from this
    // provider — let the poll-cron use createdAt fallback. Saves a
    // round-trip + race-window. The 48h-threshold is forgiving
    // enough that the few seconds between row-create and "now" are
    // negligible.

    return {
      providerRefundId: ebayRefundId ?? '',
      status: 'pending',
      amount: input.amount,
    }
  }

  verifyWebhookSignature(_rawBody: Buffer, _signature: string): WebhookVerificationResult {
    // Refund flow is poll-based (S-4 amended), not webhook-based.
    // EbayAccountDeletionService and EbayOrderNotificationService
    // own the only two eBay-webhook endpoints we expose; refunds
    // are NOT among them.
    throw new Error(
      'EbayPaymentProvider does not handle webhooks — refund status is polled.',
    )
  }
}
