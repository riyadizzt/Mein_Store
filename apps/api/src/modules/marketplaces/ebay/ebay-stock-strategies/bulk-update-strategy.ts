/**
 * C15.6 Strategy A — BulkUpdateStrategy.
 *
 * Wraps POST /sell/inventory/v1/bulk_update_price_quantity per-SKU.
 *
 * Status (Stand 2026-05-02): broken — eBay returnt errorId 25001 (System
 * / API_INVENTORY) auf alle Calls. Strategy bleibt im Codebase für
 * Auto-Recovery sobald eBay-Support den Endpoint fixt — Selector probed
 * via Cool-Down-Ladder + 2-consecutive-success Pattern (siehe Section 3
 * PLAN.md v3).
 *
 * Per-SKU statt 25-SKU-batch:
 *   v3 Selector orchestriert per-SKU. Diese Strategy könnte intern bulk-
 *   batchen (bis 25 SKUs/Call), aber für simplicity in v3-Initial: 1 SKU
 *   pro execute(). Future-Optimization: Selector kann SKU-Set sammeln
 *   und Strategy.executeBatch(ctx[]) anbieten.
 */

import { Injectable } from '@nestjs/common'
import { EbayApiClient, EbayApiError } from '../ebay-api.client'
import { resolveEbayEnv } from '../ebay-env'
import {
  StockUpdateContext,
  StockUpdateResult,
  StockUpdateStrategy,
} from './ebay-stock-update-strategy.interface'

@Injectable()
export class BulkUpdateStrategy implements StockUpdateStrategy {
  readonly name = 'bulk' as const

  async execute(ctx: StockUpdateContext): Promise<StockUpdateResult> {
    const env = resolveEbayEnv()
    const client = new EbayApiClient(env)

    try {
      await client.request<any>(
        'POST',
        '/sell/inventory/v1/bulk_update_price_quantity',
        {
          bearer: ctx.bearerToken,
          body: {
            requests: [
              {
                offerId: ctx.offerId,
                availableQuantity: ctx.effectiveQuantity,
              },
            ],
          },
          bodyKind: 'json',
          retry: false,
        },
      )

      return {
        ok: true,
        httpStatus: 200,
        errorMessage: null,
        errorId: null,
        rateLimited: false,
      }
    } catch (e: any) {
      if (e instanceof EbayApiError) {
        const errorId = e.ebayErrors?.[0]?.errorId ?? null
        if (e.status === 429) {
          return {
            ok: false,
            httpStatus: 429,
            errorMessage: '429 rate-limited',
            errorId,
            rateLimited: true,
          }
        }
        return {
          ok: false,
          httpStatus: e.status,
          errorMessage: `eBay ${e.status}: ${e.message.slice(0, 300)}`,
          errorId,
          rateLimited: false,
        }
      }
      return {
        ok: false,
        httpStatus: 0,
        errorMessage: `network: ${(e?.message ?? String(e)).slice(0, 300)}`,
        errorId: null,
        rateLimited: false,
      }
    }
  }
}
