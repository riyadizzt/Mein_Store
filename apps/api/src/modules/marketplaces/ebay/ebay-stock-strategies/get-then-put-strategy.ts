/**
 * C15.6 Strategy B — GetThenPutStrategy.
 *
 * Workaround für broken bulk_update_price_quantity (errorId 25001).
 * 3-Step pro SKU:
 *   1. GET /sell/inventory/v1/inventory_item/{sku}
 *      → snapshot ALL fields (preserve-Pattern gegen Replace-vs-Merge-Flaw)
 *   2. PUT /sell/inventory/v1/inventory_item/{sku}
 *      → merge-pattern: spread preSnapshot + override quantity
 *   3. GET /sell/inventory/v1/inventory_item/{sku} (verify)
 *      → diff via EbaySnapshotVerifier; bei dataLossDetected → ok=false
 *
 * Replace-vs-Merge-Flaw-Mitigation:
 *   eBay's `createOrReplaceInventoryItem`-Endpoint heißt namentlich
 *   "Replace" → minimal-PUT würde alle anderen Felder löschen. Indem
 *   wir den FULL body von GET nehmen + nur quantity ersetzen, garantieren
 *   wir dass eBay nichts Erwartetes löscht. Snapshot-Verifier verifiziert
 *   das empirisch nach jedem Call.
 *
 * primary post-deploy strategy in v3.
 *
 * Owner-Enhancements (Block 2 v3):
 *   ENHANCEMENT 1: Defensive null-check vor Spread-Pattern (preSnapshot
 *                  missing availability structure → INVALID_STATE return)
 *   ENHANCEMENT 2: errorId optional chaining (defensive against malformed
 *                  eBay responses)
 *   ENHANCEMENT 3: verify-GET explicit timeout 5000ms (per-step timeout
 *                  shorter than default 15s; transient-fail isolated)
 *   ENHANCEMENT 4: Verify-GET failure tracking via HealthService
 *                  (recordVerifyFailure → admin-alert wenn >5/h)
 */

import { Injectable, Logger } from '@nestjs/common'
import { EbayApiClient, EbayApiError } from '../ebay-api.client'
import { resolveEbayEnv } from '../ebay-env'
import { EbaySnapshotVerifier } from '../ebay-snapshot-verifier'
import { EbayEndpointHealthService } from '../ebay-endpoint-health.service'
import {
  StockUpdateContext,
  StockUpdateResult,
  StockUpdateStrategy,
} from './ebay-stock-update-strategy.interface'

const VERIFY_GET_TIMEOUT_MS = 5000

@Injectable()
export class GetThenPutStrategy implements StockUpdateStrategy {
  readonly name = 'get_then_put' as const
  private readonly logger = new Logger(GetThenPutStrategy.name)

  constructor(
    private readonly verifier: EbaySnapshotVerifier,
    private readonly health: EbayEndpointHealthService,
  ) {}

  async execute(ctx: StockUpdateContext): Promise<StockUpdateResult> {
    const env = resolveEbayEnv()
    const client = new EbayApiClient(env)
    const skuPath = `/sell/inventory/v1/inventory_item/${encodeURIComponent(ctx.sku)}`

    // Step 1: GET preSnapshot (full body)
    let preSnapshot: any
    try {
      preSnapshot = await client.request<any>('GET', skuPath, { bearer: ctx.bearerToken, retry: false })
    } catch (e: any) {
      return this.toFailureResult(e, 'preSnapshot_get_failed')
    }

    // ENHANCEMENT 1 — Defensive null-check before Spread-Pattern.
    // If pre-snapshot lacks availability structure, spread would silently produce
    // an incomplete body. Bail out early with INVALID_STATE error.
    if (!preSnapshot?.availability?.shipToLocationAvailability) {
      this.logger.warn(
        `[get-then-put] sku=${ctx.sku} pre-snapshot missing availability.shipToLocationAvailability — INVALID_STATE`,
      )
      return {
        ok: false,
        httpStatus: 200,
        errorMessage: 'Pre-snapshot missing availability structure (INVALID_STATE)',
        errorId: null,
        rateLimited: false,
        preSnapshot,
        verifiedSuccess: false,
      }
    }

    // Step 2: PUT modified body (preserve all fields, override quantity only)
    const modifiedBody = {
      ...preSnapshot,
      availability: {
        ...preSnapshot.availability,
        shipToLocationAvailability: {
          ...preSnapshot.availability.shipToLocationAvailability,
          quantity: ctx.effectiveQuantity,
        },
      },
    }

    try {
      await client.request<any>('PUT', skuPath, {
        bearer: ctx.bearerToken,
        body: modifiedBody,
        bodyKind: 'json',
        retry: false,
      })
    } catch (e: any) {
      return this.toFailureResult(e, 'put_failed', preSnapshot)
    }

    // Step 3: GET postSnapshot for verification
    // ENHANCEMENT 3 — Explicit 5s timeout for verify-GET (shorter than default).
    // ENHANCEMENT 4 — On verify-GET failure: track via HealthService for admin-alert.
    let postSnapshot: any
    let verifyTimedOut = false
    try {
      postSnapshot = await this.requestWithTimeout(
        client,
        'GET',
        skuPath,
        ctx.bearerToken,
        VERIFY_GET_TIMEOUT_MS,
      )
    } catch (e: any) {
      verifyTimedOut = e?.message === '__VERIFY_GET_TIMEOUT__'
      this.logger.warn(
        `[get-then-put] post-GET ${verifyTimedOut ? 'TIMEOUT' : 'failed'} for sku=${ctx.sku} ` +
          `(PUT was successful): ${e?.message ?? e}`,
      )
      // ENHANCEMENT 4: track verify-failure → admin-alert if >5/h
      const tracking = await this.health.recordVerifyFailure(this.name)
      if (tracking.alertTriggered) {
        this.logger.error(
          `[get-then-put] VERIFY_GET_FAILURES_THRESHOLD reached: ${tracking.count}/h — admin alert needed`,
        )
        // Selector picks this up via audit-log; alerting handled there
      }
      // Return ok=true: data was put successfully. Caller can audit-log
      // STOCK_PUSH_VERIFY_GET_TIMEOUT or STOCK_PUSH_VERIFY_GET_FAILED.
      // verifiedSuccess=false: PUT returned 204 but verify-GET could not
      // confirm the eBay-side state. Push-service uses this to skip
      // lastSyncedQuantity write — next cron will retry verification.
      return {
        ok: true,
        httpStatus: 204,
        errorMessage: verifyTimedOut ? 'verify-get-timeout' : 'verify-get-failed',
        errorId: null,
        rateLimited: false,
        preSnapshot,
        postSnapshot: null,
        verifiedSuccess: false,
      }
    }

    // Step 4: Diff via Verifier
    const diff = this.verifier.diff(preSnapshot, postSnapshot, ctx.effectiveQuantity)
    if (diff.dataLossDetected) {
      return {
        ok: false,
        httpStatus: 204,
        errorMessage: `Data-loss detected after PUT: fields=${diff.changedFields.join(',')}`,
        errorId: null,
        rateLimited: false,
        preSnapshot,
        postSnapshot,
        dataLossDetected: true,
        dataLossFields: diff.changedFields,
        verifiedSuccess: false,
      }
    }
    if (!diff.quantityCorrect) {
      return {
        ok: false,
        httpStatus: 204,
        errorMessage: `Quantity mismatch post-PUT: expected=${ctx.effectiveQuantity}, got=${
          postSnapshot?.availability?.shipToLocationAvailability?.quantity
        }`,
        errorId: null,
        rateLimited: false,
        preSnapshot,
        postSnapshot,
        verifiedSuccess: false,
      }
    }

    // Full chain success: GET → PUT → verify-GET confirmed quantity matches
    // and PRESERVE_FIELDS unchanged. eBay-side state proven in sync.
    return {
      ok: true,
      httpStatus: 204,
      errorMessage: null,
      errorId: null,
      rateLimited: false,
      preSnapshot,
      postSnapshot,
      verifiedSuccess: true,
    }
  }

  /**
   * Wraps client.request with an explicit timeout (ENHANCEMENT 3).
   * Used for verify-GET only — shorter than default 15s timeout.
   * On timeout: throws Error with marker message '__VERIFY_GET_TIMEOUT__'.
   */
  private async requestWithTimeout(
    client: EbayApiClient,
    method: 'GET',
    endpoint: string,
    bearer: string,
    timeoutMs: number,
  ): Promise<any> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('__VERIFY_GET_TIMEOUT__')), timeoutMs)
    })
    const callPromise = client.request<any>(method, endpoint, { bearer, retry: false })
    return Promise.race([callPromise, timeoutPromise])
  }

  private toFailureResult(e: any, stage: string, preSnapshot?: any): StockUpdateResult {
    if (e instanceof EbayApiError) {
      const errorId = e.ebayErrors?.[0]?.errorId ?? null
      if (e.status === 429) {
        return {
          ok: false,
          httpStatus: 429,
          errorMessage: `429 rate-limited at ${stage}`,
          errorId,
          rateLimited: true,
          preSnapshot,
          verifiedSuccess: false,
        }
      }
      return {
        ok: false,
        httpStatus: e.status,
        errorMessage: `eBay ${e.status} at ${stage}: ${e.message.slice(0, 300)}`,
        errorId,
        rateLimited: false,
        preSnapshot,
        verifiedSuccess: false,
      }
    }
    return {
      ok: false,
      httpStatus: 0,
      errorMessage: `network at ${stage}: ${(e?.message ?? String(e)).slice(0, 300)}`,
      errorId: null,
      rateLimited: false,
      preSnapshot,
      verifiedSuccess: false,
    }
  }
}
