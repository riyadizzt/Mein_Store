/**
 * EbayStockPushService (C15).
 *
 * Pushes effective stock quantities for active eBay listings to eBay
 * via POST /sell/inventory/v1/bulk_update_price_quantity. Used by
 * BOTH the listener fast-path (1-item array) AND the reconcile cron
 * (25-item batches).
 *
 * Why bulk_update_price_quantity for both paths
 * ─────────────────────────────────────────────
 * Decision G-2 in C15 Phase B (owner-approved): use the bulk endpoint
 * even for single-SKU listener calls. Reasons:
 *   (1) PUT /inventory_item is full-replace — risks overwriting
 *       title/aspects/images that C11 published, if the in-DB state
 *       has drifted from what was last published.
 *   (2) bulk_update_price_quantity is documented as quantity (and
 *       price) only — no risk of touching listing-detail fields.
 *   (3) Single endpoint for both paths = single test surface, single
 *       error-shape parser, single rate-limit accountant.
 *
 * Effective quantity formula
 * ──────────────────────────
 *   effective = max(0, availableStock - safetyStock)
 *   availableStock = max_over_warehouses(quantityOnHand - quantityReserved)
 *
 * The max-per-warehouse semantic mirrors C5 (channel-safety-stock)
 * and the cart/feed reader — eBay can only sell what one warehouse
 * actually holds, not the SUM across warehouses.
 *
 * Idempotency
 * ───────────
 * Pre-flight per listing: skip if `lastSyncedQuantity === effective`.
 * On successful push: UPDATE lastSyncedQuantity + lastSyncedAt in
 * the same prisma-call. Concurrent pushes for the same SKU are safe:
 * worst case the second computation produces the same quantity and
 * the second update becomes a no-op-shaped write Postgres tolerates.
 *
 * Pause-state cooperation with C5
 * ───────────────────────────────
 * Listings with status != 'active' are skipped at the pre-flight
 * stage. C5 flips listing.status='paused' BEFORE C15 runs (C5 hook
 * fires first at every call-site), so a low-stock auto-pause
 * automatically prevents the corresponding quantity-push. eBay would
 * reject pushes for paused listings anyway.
 *
 * Defensive multi-path response parsing (Y-2 from C13.3 doctrine)
 * ───────────────────────────────────────────────────────────────
 * eBay's bulk_update_price_quantity per-SKU error-shape was NOT
 * verified pre-deploy (no live sandbox order with active listing at
 * build time). The code looks for per-SKU error-arrays at FOUR known
 * shapes and logs the complete raw response for the first 10 batches
 * so production-debugging is possible. If all paths fail to identify
 * a per-SKU outcome, we fall back to "all-or-nothing" interpretation:
 * 2xx = all SKUs in the batch succeeded.
 *
 * Hard-Rule compliance
 * ────────────────────
 *   - Orders/Payments/Invoices/Returns/Reservations: ZERO TOUCH
 *   - C5 helper: ZERO TOUCH (parallel C15 helper consumes this service)
 *   - C11 listing-publish flow: ZERO TOUCH (price/title/image stay there)
 *   - Existing eBay services: ZERO TOUCH (this is a new sibling)
 */

import { Injectable, Logger, Optional } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { EbayStockStrategySelector } from './ebay-stock-strategy-selector'
import { PrismaService } from '../../../prisma/prisma.service'
import {
  EbayAuthService,
  EbayNotConnectedError,
  EbayRefreshRevokedError,
} from './ebay-auth.service'
import { AuditService } from '../../admin/services/audit.service'
import { NotificationService } from '../../admin/services/notification.service'
import { computeAvailableStock } from '../../../common/helpers/channel-safety-stock'
import {
  ChannelStockPusher,
  registerChannelStockPusher,
} from '../../../common/helpers/channel-stock-push'

/**
 * Cap on per-SKU push attempts before we surrender. After this we
 * still let the cron try — the counter resets on success, so a
 * transient-then-recovered SKU isn't permanently shut out.
 */
export const MAX_PUSH_ATTEMPTS = 5

/**
 * eBay's documented bulk batch-cap. Keep below 25 to leave headroom
 * for future schema additions to the request body.
 */
export const EBAY_BULK_BATCH_SIZE = 25

/** First-Run-Logging window — log raw response of first N batches. */
const FIRST_RUN_LOG_LIMIT = 10

export const STOCK_AUDIT_ACTIONS = {
  PUSH_FAILED: 'CHANNEL_STOCK_PUSH_FAILED',
  RATE_LIMITED: 'EBAY_STOCK_RATE_LIMITED',
} as const

export interface PushItemResult {
  listingId: string
  variantId: string
  sku: string
  effective: number
  status: 'pushed' | 'skipped_no_change' | 'skipped_paused' | 'skipped_no_offer_id' | 'skipped_no_sku' | 'failed'
  error?: string
}

export interface PushBatchResult {
  scanned: number
  pushed: number
  skipped: number
  failed: number
  rateLimited: boolean
  items: PushItemResult[]
}

@Injectable()
export class EbayStockPushService implements ChannelStockPusher {
  private readonly logger = new Logger(EbayStockPushService.name)

  // ModuleRef-based lazy resolution of EbayAuthService — same pattern
  // as EbayPaymentProvider hotfix (C13.3 commit 1195088) and
  // EbayShippingPushService (C14). Avoids module-load-time DI cycles.
  private cachedAuth: EbayAuthService | null = null

  // First-Run-Logging: log raw eBay response for first N bulk-calls
  // so production can capture the actual response shape.
  private rawLogCount = 0

  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleRef: ModuleRef,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    // C15.6: Selector orchestriert Multi-Strategy push per SKU.
    // @Optional damit existing tests die ohne Selector instantiieren weiterlaufen
    // (Tests werden in Block 4 spec-synced).
    @Optional() private readonly selector?: EbayStockStrategySelector,
  ) {}

  /**
   * Self-register at module-init so the C15 helper
   * (channel-stock-push.ts) can reach this service from
   * ReservationService / AdminInventoryService without a DI cycle.
   * Same singleton-ref pattern as C5 (channel-safety-stock).
   */
  onModuleInit(): void {
    registerChannelStockPusher(this)
  }

  private async getAuth(): Promise<EbayAuthService> {
    if (this.cachedAuth) return this.cachedAuth
    const resolved = this.moduleRef.get(EbayAuthService, { strict: false })
    if (!resolved) {
      throw new Error('EbayStockPushService: EbayAuthService not resolvable via ModuleRef')
    }
    this.cachedAuth = resolved
    return resolved
  }

  // ─────────────────────────────────────────────────────────────
  // ChannelStockPusher interface — listener fast-path entry point
  // ─────────────────────────────────────────────────────────────

  /**
   * Called by the C15 helper from stock-mutation hot-paths. Looks up
   * all eBay listings for these variants and pushes their effective
   * quantities. Single-batch (variantIds typically <= 5 — one cart
   * line worth). Never throws.
   */
  async pushForVariants(variantIds: string[]): Promise<void> {
    if (!variantIds || variantIds.length === 0) return
    try {
      const listings = await this.loadCandidateListings({ variantIds })
      if (listings.length === 0) return
      await this.pushListings(listings, /* fromCron */ false)
    } catch (err: any) {
      // Never propagate — caller is fire-and-forget. Cron will catch.
      this.logger.warn(
        `[ebay-stock-push] pushForVariants failed for ${variantIds.length} variant(s): ${err?.message ?? err}`,
      )
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Reconcile-cron entry point
  // ─────────────────────────────────────────────────────────────

  /**
   * Called by EbayStockReconcileCron every 15 minutes. Scans all
   * active eBay listings for drift and pushes corrections in 25-SKU
   * bulk batches. Safety-cap on listings/tick prevents runaway
   * scans during pathological event-storms.
   */
  async runReconcileTick(maxListings = 500): Promise<PushBatchResult> {
    const listings = await this.loadCandidateListings({
      cron: true,
      maxListings,
    })
    if (listings.length === 0) {
      return { scanned: 0, pushed: 0, skipped: 0, failed: 0, rateLimited: false, items: [] }
    }
    return this.pushListings(listings, /* fromCron */ true)
  }

  // ─────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────

  private async loadCandidateListings(opts: {
    variantIds?: string[]
    cron?: boolean
    maxListings?: number
  }): Promise<Array<any>> {
    // C15.4 — filter by externalOfferId (the actual key used by
    // bulk_update_price_quantity). externalListingId stays in the SELECT
    // for audit/logging only. Anti-spam: skip exhausted listings
    // (syncAttempts >= MAX_PUSH_ATTEMPTS) — they need an admin reset
    // via /admin/marketplaces/ebay/listings/:id/reset-sync before the
    // cron picks them up again. Listings without externalOfferId are
    // legacy rows awaiting backfill or a re-publish — silently skipped.
    const where: any = {
      channel: 'ebay',
      status: 'active',
      externalOfferId: { not: null },
      syncAttempts: { lt: MAX_PUSH_ATTEMPTS },
    }
    if (opts.variantIds) {
      where.variantId = { in: opts.variantIds }
    } else {
      where.variantId = { not: null }
    }
    return this.prisma.channelProductListing.findMany({
      where,
      select: {
        id: true,
        variantId: true,
        externalListingId: true,
        externalOfferId: true,
        safetyStock: true,
        lastSyncedQuantity: true,
        syncAttempts: true,
        status: true,
        pauseReason: true,
        variant: {
          select: { id: true, sku: true },
        },
      },
      take: opts.maxListings ?? 1000,
      orderBy: opts.cron ? { lastSyncedAt: 'asc' } : undefined,
    })
  }

  /**
   * Compute effective quantity for a list of variantIds via a single
   * inventory.findMany. Returns Map<variantId, effective>.
   */
  private async computeEffectiveByVariant(
    variantIds: string[],
    safetyByVariant: Map<string, number>,
  ): Promise<Map<string, number>> {
    if (variantIds.length === 0) return new Map()
    const rows = await this.prisma.inventory.findMany({
      where: { variantId: { in: variantIds } },
      select: { variantId: true, quantityOnHand: true, quantityReserved: true },
    })
    const grouped = new Map<string, Array<{ quantityOnHand: number; quantityReserved: number }>>()
    for (const r of rows) {
      const list = grouped.get(r.variantId) ?? []
      list.push({ quantityOnHand: r.quantityOnHand, quantityReserved: r.quantityReserved })
      grouped.set(r.variantId, list)
    }
    const effective = new Map<string, number>()
    for (const variantId of variantIds) {
      const inv = grouped.get(variantId) ?? []
      const available = computeAvailableStock(inv)
      const safety = safetyByVariant.get(variantId) ?? 0
      effective.set(variantId, Math.max(0, available - safety))
    }
    return effective
  }

  /**
   * Core push routine: filter, batch, call eBay, persist outcomes.
   * Used by both listener and cron paths.
   */
  private async pushListings(
    listings: Array<any>,
    fromCron: boolean,
  ): Promise<PushBatchResult> {
    const result: PushBatchResult = {
      scanned: listings.length,
      pushed: 0,
      skipped: 0,
      failed: 0,
      rateLimited: false,
      items: [],
    }

    // 1. Filter out listings without SKU or externalOfferId. Build
    //    safety-stock map so we can compute effective per-variant.
    //    C15.4: defensive double-check on externalOfferId — the
    //    where-clause in loadCandidateListings already excludes nulls,
    //    but listener-fed listings may not pass through that filter.
    const variantIds: string[] = []
    const safetyByVariant = new Map<string, number>()
    const skipped: PushItemResult[] = []
    for (const l of listings) {
      if (!l.variantId) {
        skipped.push({
          listingId: l.id,
          variantId: '',
          sku: '',
          effective: 0,
          status: 'skipped_no_sku',
        })
        continue
      }
      const sku = l.variant?.sku
      if (!sku) {
        skipped.push({
          listingId: l.id,
          variantId: l.variantId,
          sku: '',
          effective: 0,
          status: 'skipped_no_sku',
        })
        continue
      }
      if (!l.externalOfferId) {
        skipped.push({
          listingId: l.id,
          variantId: l.variantId,
          sku,
          effective: 0,
          status: 'skipped_no_offer_id',
        })
        continue
      }
      variantIds.push(l.variantId)
      safetyByVariant.set(l.variantId, l.safetyStock ?? 0)
    }
    result.skipped += skipped.length
    result.items.push(...skipped)
    if (variantIds.length === 0) return result

    // 2. Compute effective quantity per variant in one query.
    const effectiveByVariant = await this.computeEffectiveByVariant(
      variantIds,
      safetyByVariant,
    )

    // 3. Build push-set: skip listings where lastSyncedQuantity matches
    //    effective. These are no-ops; pushing them wastes API budget.
    const toPush: Array<{
      listing: any
      sku: string
      effective: number
      offerId: string
    }> = []
    for (const l of listings) {
      if (!l.variantId || !l.variant?.sku || !l.externalOfferId) continue // already in skipped
      const sku = l.variant.sku
      const effective = effectiveByVariant.get(l.variantId) ?? 0
      if (l.lastSyncedQuantity === effective) {
        result.skipped++
        result.items.push({
          listingId: l.id,
          variantId: l.variantId,
          sku,
          effective,
          status: 'skipped_no_change',
        })
        continue
      }
      // C15.4 BUG-FIX-KERN: bulk_update_price_quantity erwartet die
      // eBay offerId (numerisch, z.B. "158298846011"), NICHT die
      // public listingId ("406893266945"). Format-Tarn-Effekt:
      // beide 12-stellig numerisch — visuell nicht unterscheidbar.
      // Empirisch verifiziert via W3-Production-Probe 2026-05-01.
      toPush.push({
        listing: l,
        sku,
        effective,
        offerId: l.externalOfferId,
      })
    }
    if (toPush.length === 0) return result

    // 4. Pre-check eBay connection ONCE per call (not per batch).
    const config = await this.prisma.salesChannelConfig.findUnique({
      where: { channel: 'ebay' },
      select: { isActive: true, accessToken: true },
    })
    if (!config?.isActive || !config?.accessToken) {
      this.logger.warn(`[ebay-stock-push] not connected — skipping ${toPush.length} push(es)`)
      return result
    }

    let bearer: string
    try {
      const auth = await this.getAuth()
      bearer = await auth.getAccessTokenOrRefresh()
    } catch (e) {
      if (e instanceof EbayRefreshRevokedError || e instanceof EbayNotConnectedError) {
        this.logger.warn(`[ebay-stock-push] auth unavailable: ${(e as Error).message}`)
        return result
      }
      throw e
    }

    // 5. C15.6: Per-SKU iteration via Selector (replaces 25-SKU bulk-chunk).
    //    Selector orchestriert Multi-Strategy mit Auto-Fallback + Per-SKU-Lock
    //    + ESCALATE-Pfad. Wenn Selector nicht injected ist (legacy-tests):
    //    fallback to direct bulk_update_price_quantity (alt-pfad).
    if (!this.selector) {
      // Legacy code-path — wird in Block 4 spec-synced + entfernt.
      // For now: emit warning + early-return ohne push (fail-safe).
      this.logger.warn('[ebay-stock-push] no Selector injected — legacy fallback (no push)')
      return result
    }

    for (const c of toPush) {
      const stratResult = await this.selector.executeForSku({
        listing: { id: c.listing.id, variantId: c.listing.variantId, externalListingId: c.listing.externalListingId ?? null },
        sku: c.sku,
        offerId: c.offerId,
        effectiveQuantity: c.effective,
        bearerToken: bearer,
      })

      // 429 short-circuit (preserves alt-Verhalten)
      if (stratResult.rateLimited) {
        result.rateLimited = true
        await this.audit
          .log({
            adminId: 'system',
            action: STOCK_AUDIT_ACTIONS.RATE_LIMITED,
            entityType: 'channel_listing',
            entityId: c.listing.id,
            changes: { after: { sku: c.sku, fromCron } },
          })
          .catch(() => {})
        result.items.push({
          listingId: c.listing.id,
          variantId: c.listing.variantId,
          sku: c.sku,
          effective: c.effective,
          status: 'failed',
          error: '429 rate-limited',
        })
        result.failed++
        return result
      }

      // Skipped (Lock-held-by-other or REDIS-OUTAGE-SKIP) — caller bumps not-touched
      if (stratResult.skipped) {
        result.skipped++
        result.items.push({
          listingId: c.listing.id,
          variantId: c.listing.variantId,
          sku: c.sku,
          effective: c.effective,
          status: 'skipped_no_change',
        })
        continue
      }

      // First-Run-Logging (per-SKU statt per-batch)
      if (this.rawLogCount < FIRST_RUN_LOG_LIMIT) {
        this.rawLogCount++
        const summary = stratResult.ok
          ? 'OK'
          : `FAIL (${stratResult.httpStatus}): ${stratResult.errorMessage}`
        this.logger.log(
          `[ebay-stock-push] first-run #${this.rawLogCount}/${FIRST_RUN_LOG_LIMIT} sku=${c.sku}: ${summary}`,
        )
      }

      if (stratResult.ok) {
        try {
          await this.prisma.channelProductListing.update({
            where: { id: c.listing.id },
            data: {
              lastSyncedQuantity: c.effective,
              lastSyncedAt: new Date(),
              syncAttempts: 0,
              syncError: null,
            },
          })
        } catch (writeErr: any) {
          this.logger.warn(
            `[ebay-stock-push] DB persist failed listing=${c.listing.id}: ${writeErr?.message}`,
          )
        }
        result.pushed++
        result.items.push({
          listingId: c.listing.id,
          variantId: c.listing.variantId,
          sku: c.sku,
          effective: c.effective,
          status: 'pushed',
        })
      } else {
        const errMsg = stratResult.errorMessage ?? 'unknown error'
        await this.persistFailure(c.listing, errMsg)
        result.failed++
        result.items.push({
          listingId: c.listing.id,
          variantId: c.listing.variantId,
          sku: c.sku,
          effective: c.effective,
          status: 'failed',
          error: errMsg,
        })
      }
    }

    return result
  }

  /**
   * Persist a per-listing failure: increment syncAttempts, store
   * error, notify admin on exhaustion.
   */
  private async persistFailure(listing: any, errMsg: string): Promise<void> {
    const newAttempts = (listing.syncAttempts ?? 0) + 1
    try {
      await this.prisma.channelProductListing.update({
        where: { id: listing.id },
        data: {
          syncAttempts: newAttempts,
          syncError: errMsg.slice(0, 500),
        },
      })
    } catch (writeErr: any) {
      this.logger.warn(
        `[ebay-stock-push] DB persist-failure failed for listing=${listing.id}: ${writeErr?.message ?? writeErr}`,
      )
      return
    }

    if (newAttempts >= MAX_PUSH_ATTEMPTS) {
      this.logger.error(
        `[ebay-stock-push] EXHAUSTED listing=${listing.id} attempts=${newAttempts} error=${errMsg}`,
      )
      await this.audit
        .log({
          adminId: 'system',
          action: STOCK_AUDIT_ACTIONS.PUSH_FAILED,
          entityType: 'channel_listing',
          entityId: listing.id,
          changes: { after: { attempts: newAttempts, error: errMsg } },
        })
        .catch(() => {})
      await this.notifications
        .createForAllAdmins({
          type: 'channel_stock_push_failed',
          title: 'eBay Bestand-Sync fehlgeschlagen',
          body: `Bestand für ein eBay-Listing konnte nach ${newAttempts} Versuchen nicht aktualisiert werden. Bitte im Seller Hub prüfen.`,
          entityType: 'channel_listing',
          entityId: listing.id,
          data: { attempts: newAttempts, error: errMsg },
        })
        .catch((e: any) =>
          this.logger.warn(`[ebay-stock-push] notify failed: ${e?.message ?? e}`),
        )
    }
  }

  // Test helper
  __resetRawLogCountForTests(): void {
    this.rawLogCount = 0
  }
}

/**
 * Defensive multi-path per-SKU error extractor.
 *
 * eBay's bulk_update_price_quantity response shape per SKU is not
 * pre-deploy-verified. Tries four known shapes:
 *   (a) responses[].errors[] keyed by offerId
 *   (b) responses[].errors[] keyed by sku
 *   (c) responses[] with statusCode != 2xx
 *   (d) errors[] at top level (all-or-nothing)
 *
 * Returns Map<key, errorMessage> where key is offerId OR sku
 * depending on what the response uses. Caller does map.get(offerId)
 * ?? map.get(sku) for resolution.
 */
export function extractPerSkuErrors(response: any): Map<string, string> {
  const map = new Map<string, string>()
  if (!response || typeof response !== 'object') return map

  // Path (a)/(b)/(c): per-item array
  const perItem = Array.isArray(response.responses) ? response.responses : null
  if (perItem) {
    for (const item of perItem) {
      const itemKey = item?.offerId ?? item?.sku ?? null
      if (!itemKey) continue
      const errors = Array.isArray(item.errors) ? item.errors : null
      if (errors && errors.length > 0) {
        const firstErr = errors[0]
        const msg = firstErr?.message ?? firstErr?.longMessage ?? `errorId=${firstErr?.errorId ?? 'unknown'}`
        map.set(String(itemKey), String(msg).slice(0, 300))
      } else if (item.statusCode != null && (item.statusCode < 200 || item.statusCode >= 300)) {
        map.set(String(itemKey), `eBay statusCode=${item.statusCode}`)
      }
    }
  }

  return map
}
