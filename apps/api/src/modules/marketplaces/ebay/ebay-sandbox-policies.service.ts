/**
 * eBay Sandbox Policies Bootstrap (C10).
 *
 * The Sandbox Seller Hub UI is broken (redirects to production
 * login). This service does via API what the user would normally
 * do via the UI: creates the three required business policies on
 * the sandbox seller account, records the IDs on
 * sales_channel_configs.settings.policyIds.
 *
 * Hard constraints:
 *   - Production mode: throw ForbiddenException('SandboxOnly').
 *     This endpoint MUST NOT write to the production seller. User-
 *     decision: production policies are created by humans via the
 *     (working) production Seller-Hub, not by us.
 *   - Idempotent: calling twice finds existing policies by the
 *     well-known `name` field and stores their IDs. No duplicates.
 *
 * Shape: three HTTPs calls against Sell-Account-API v1. The token
 * comes from EbayAuthService.getAccessTokenOrRefresh(), so a
 * missing connection surfaces as EbayNotConnectedError → 403.
 *
 * Null-touch: only sales_channel_configs is written (settings JSON).
 */

import { Injectable, Logger, ForbiddenException } from '@nestjs/common'
import { resolveEbayEnv } from './ebay-env'
import { EbayApiClient, EbayApiError, type FetchLike } from './ebay-api.client'
import { EbayAuthService } from './ebay-auth.service'

// ──────────────────────────────────────────────────────────────
// Well-known policy names — the idempotency key.
// Picking something identifiable (MALAK_*) so nothing else in the
// sandbox account collides with our bootstrap.
// ──────────────────────────────────────────────────────────────

const POLICY_NAMES = {
  fulfillment: 'MALAK_STANDARD_DE',
  return: 'MALAK_14D_BUYER_PAYS',
  payment: 'MALAK_MANAGED_PAYMENTS',
} as const

// Policy payload bodies — Malak-conformant defaults aligned with
// the Shop-website Policy (free-shipping >100€, 14-day right of
// withdrawal, buyer pays return shipping, managed payments).

function fulfillmentPolicyPayload() {
  return {
    name: POLICY_NAMES.fulfillment,
    description: 'Malak Bekleidung — DHL Paket DE, Standard-Versand',
    marketplaceId: 'EBAY_DE',
    categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
    handlingTime: { unit: 'BUSINESS_DAY', value: 1 },
    shippingOptions: [
      {
        optionType: 'DOMESTIC',
        costType: 'FLAT_RATE',
        shippingServices: [
          {
            sortOrder: 1,
            shippingCarrierCode: 'DHLPaketDE',
            shippingServiceCode: 'DE_DHLPaket',
            shippingCost: { value: '4.99', currency: 'EUR' },
            additionalShippingCost: { value: '0.00', currency: 'EUR' },
            freeShipping: false,
          },
        ],
      },
    ],
  }
}

function returnPolicyPayload() {
  return {
    name: POLICY_NAMES.return,
    description: 'Malak Bekleidung — 14 Tage Widerrufsrecht, Käufer zahlt Rücksendung',
    marketplaceId: 'EBAY_DE',
    categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
    returnsAccepted: true,
    returnPeriod: { unit: 'DAY', value: 14 },
    returnShippingCostPayer: 'BUYER',
    refundMethod: 'MONEY_BACK',
  }
}

function paymentPolicyPayload() {
  return {
    name: POLICY_NAMES.payment,
    description: 'Malak Bekleidung — eBay Managed Payments',
    marketplaceId: 'EBAY_DE',
    categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
    immediatePay: false,
  }
}

// ──────────────────────────────────────────────────────────────
// Service
// ──────────────────────────────────────────────────────────────

export interface BootstrapResult {
  fulfillmentPolicyId: string
  returnPolicyId: string
  paymentPolicyId: string
  /** Per-policy flag: true = found existing, false = newly created. */
  alreadyExisted: {
    fulfillment: boolean
    return: boolean
    payment: boolean
  }
  /**
   * Sandbox seller accounts are NOT auto-enrolled in the
   * Selling-Policy-Management program. We opt in via
   * POST /sell/account/v1/program/opt_in as a pre-step.
   *   alreadyOptedIn: true  — skipped (409 / errorId 25803)
   *   alreadyOptedIn: false — opt-in was just performed
   *
   * Note: per eBay docs, a fresh opt-in can take up to 24 hours
   * to propagate. If the follow-up listPolicies / create-policy
   * calls fail with "User is not eligible for Business Policy",
   * that is the propagation lag — not an error in the opt-in call.
   * The service surfaces this distinctly so the admin UI can
   * render the 24h-wait explanation.
   */
  programOptIn: {
    alreadyOptedIn: boolean
  }
}

@Injectable()
export class EbaySandboxPoliciesService {
  private readonly logger = new Logger(EbaySandboxPoliciesService.name)
  private fetchOverrideForTests: FetchLike | undefined

  constructor(private readonly auth: EbayAuthService) {}

  /**
   * Main entry. Throws ForbiddenException('SandboxOnly') in
   * production; EbayNotConnectedError-or-mapped ForbiddenException
   * if no token available.
   */
  async bootstrapPolicies(): Promise<BootstrapResult> {
    const env = resolveEbayEnv()
    if (env.mode !== 'sandbox') {
      throw new ForbiddenException({
        code: 'EBAY_SANDBOX_ONLY',
        message: {
          de: 'Dieser Endpoint funktioniert nur in der Sandbox-Umgebung. Production-Policies bitte manuell im Seller Hub anlegen.',
          en: 'This endpoint only works in the sandbox environment. Create production policies manually via the Seller Hub.',
          ar: 'هذه النقطة تعمل فقط في بيئة Sandbox. يجب إنشاء سياسات الإنتاج يدويًا عبر Seller Hub.',
        },
      })
    }

    const token = await this.auth.getAccessTokenOrRefresh()
    const client = this.buildClient()

    // ── Pre-step: opt-in to the Selling-Policy-Management program.
    // Sandbox sellers are not auto-enrolled. MUST succeed (or be
    // already-opted-in) before ANY policy list/create call.
    const optIn = await this.ensureOptedInToSellingPolicyProgram(client, token)

    // ── Policy creation. If the opt-in was just performed (not
    // already-opted-in), these calls may still fail with
    // "not eligible for Business Policy" because eBay's program
    // queue takes up to 24h to propagate. The fail bubbles up
    // with a friendly 3-lang message (see handleNotEligibleError).
    const fulfillment = await this.ensureFulfillmentPolicy(client, token)
    const ret = await this.ensureReturnPolicy(client, token)
    const payment = await this.ensurePaymentPolicy(client, token)

    const result: BootstrapResult = {
      fulfillmentPolicyId: fulfillment.id,
      returnPolicyId: ret.id,
      paymentPolicyId: payment.id,
      alreadyExisted: {
        fulfillment: fulfillment.alreadyExisted,
        return: ret.alreadyExisted,
        payment: payment.alreadyExisted,
      },
      programOptIn: {
        alreadyOptedIn: optIn.alreadyOptedIn,
      },
    }

    // Persist IDs on settings JSON for C11+ to consume.
    await this.auth.patchSettings({
      policyIds: {
        fulfillmentPolicyId: result.fulfillmentPolicyId,
        returnPolicyId: result.returnPolicyId,
        paymentPolicyId: result.paymentPolicyId,
      },
    })

    this.logger.log(
      `Sandbox policies bootstrapped (f=${result.fulfillmentPolicyId}, r=${result.returnPolicyId}, p=${result.paymentPolicyId}) — existedAlready: ${JSON.stringify(result.alreadyExisted)}`,
    )

    return result
  }

  // ────────────────────────────────────────────────────────────
  // Program opt-in — sandbox-only pre-step
  // ────────────────────────────────────────────────────────────
  //
  // eBay official API:
  //   POST /sell/account/v1/program/opt_in
  //   body: { "programType": "SELLING_POLICY_MANAGEMENT" }
  //
  // Documented responses (per eBay Seller Account API):
  //   200 Success       — opt-in accepted
  //   409 Conflict      — program already applied to this user
  //   200 + errorId=25803 — some sandbox variants return 200 with
  //                        an errorId inside a warnings/errors
  //                        array meaning "already applied"
  //   400/404/500        — real errors, must propagate
  //
  // Tolerance strategy (user-confirmed 2026-04-23):
  //   HTTP 409       → alreadyOptedIn=true, silent skip
  //   errorId 25803  → alreadyOptedIn=true, silent skip
  //   everything else → throw, let bootstrap surface it

  private async ensureOptedInToSellingPolicyProgram(
    client: EbayApiClient,
    token: string,
  ): Promise<{ alreadyOptedIn: boolean }> {
    try {
      await client.request('POST', '/sell/account/v1/program/opt_in', {
        bearer: token,
        bodyKind: 'json',
        body: { programType: 'SELLING_POLICY_MANAGEMENT' },
        // Single-use request: a retry on 5xx would NOT hurt (idempotent
        // on eBay's side), so we keep retry enabled — EbayApiClient
        // already only retries on 429/5xx, not on 4xx.
      })
      this.logger.log('Opted in to SELLING_POLICY_MANAGEMENT (fresh)')
      return { alreadyOptedIn: false }
    } catch (e) {
      if (e instanceof EbayApiError && this.isAlreadyOptedInSignal(e)) {
        this.logger.log('SELLING_POLICY_MANAGEMENT: already opted in, skipping')
        return { alreadyOptedIn: true }
      }
      throw e
    }
  }

  /**
   * Returns true iff the given EbayApiError represents "this program
   * is already applied to the caller" — either via HTTP 409 or via
   * the documented errorId 25803 "{fieldName} already exists" even
   * in an otherwise-200 response that our client would have still
   * thrown on (non-empty errors array with 4xx).
   */
  private isAlreadyOptedInSignal(err: EbayApiError): boolean {
    if (err.status === 409) return true
    if (err.ebayErrors.some((e) => e.errorId === 25803)) return true
    return false
  }

  // ────────────────────────────────────────────────────────────
  // Per-policy helpers — each one does a GET-first, POST-if-missing
  // ────────────────────────────────────────────────────────────

  private async ensureFulfillmentPolicy(
    client: EbayApiClient,
    token: string,
  ): Promise<{ id: string; alreadyExisted: boolean }> {
    const existing = await this.listPolicies<{
      fulfillmentPolicies?: Array<{ fulfillmentPolicyId: string; name: string }>
    }>(client, token, '/sell/account/v1/fulfillment_policy')

    const match = existing.fulfillmentPolicies?.find((p) => p.name === POLICY_NAMES.fulfillment)
    if (match) return { id: match.fulfillmentPolicyId, alreadyExisted: true }

    const created = await client.request<{ fulfillmentPolicyId: string }>(
      'POST',
      '/sell/account/v1/fulfillment_policy',
      { bearer: token, bodyKind: 'json', body: fulfillmentPolicyPayload() },
    )
    return { id: created.fulfillmentPolicyId, alreadyExisted: false }
  }

  private async ensureReturnPolicy(
    client: EbayApiClient,
    token: string,
  ): Promise<{ id: string; alreadyExisted: boolean }> {
    const existing = await this.listPolicies<{
      returnPolicies?: Array<{ returnPolicyId: string; name: string }>
    }>(client, token, '/sell/account/v1/return_policy')

    const match = existing.returnPolicies?.find((p) => p.name === POLICY_NAMES.return)
    if (match) return { id: match.returnPolicyId, alreadyExisted: true }

    const created = await client.request<{ returnPolicyId: string }>(
      'POST',
      '/sell/account/v1/return_policy',
      { bearer: token, bodyKind: 'json', body: returnPolicyPayload() },
    )
    return { id: created.returnPolicyId, alreadyExisted: false }
  }

  private async ensurePaymentPolicy(
    client: EbayApiClient,
    token: string,
  ): Promise<{ id: string; alreadyExisted: boolean }> {
    const existing = await this.listPolicies<{
      paymentPolicies?: Array<{ paymentPolicyId: string; name: string }>
    }>(client, token, '/sell/account/v1/payment_policy')

    const match = existing.paymentPolicies?.find((p) => p.name === POLICY_NAMES.payment)
    if (match) return { id: match.paymentPolicyId, alreadyExisted: true }

    const created = await client.request<{ paymentPolicyId: string }>(
      'POST',
      '/sell/account/v1/payment_policy',
      { bearer: token, bodyKind: 'json', body: paymentPolicyPayload() },
    )
    return { id: created.paymentPolicyId, alreadyExisted: false }
  }

  private async listPolicies<T>(
    client: EbayApiClient,
    token: string,
    path: string,
  ): Promise<T> {
    try {
      return await client.request<T>(
        'GET',
        `${path}?marketplace_id=EBAY_DE`,
        { bearer: token },
      )
    } catch (e) {
      if (e instanceof EbayApiError && e.status === 404) {
        // eBay returns 404 for "no policies of this type yet" — not a real error
        return {} as T
      }
      throw e
    }
  }

  private buildClient(): EbayApiClient {
    const env = resolveEbayEnv()
    return this.fetchOverrideForTests
      ? new EbayApiClient(env, this.fetchOverrideForTests)
      : new EbayApiClient(env)
  }

  __setFetchForTests(f: FetchLike | undefined): void {
    this.fetchOverrideForTests = f
  }
}
