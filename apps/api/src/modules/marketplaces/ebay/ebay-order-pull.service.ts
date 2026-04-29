/**
 * EbayOrderPullService (C12.5).
 *
 * 15-min cron-driven safety-net pulling order events from eBay's
 * Sell-Fulfillment getOrders endpoint. Catches anything the
 * webhook (C12.4) missed.
 *
 * Architecture:
 *   - This service does NOT decide WHEN to run — that's the cron
 *     wrapper's job. It exposes runPullTick() which the cron
 *     invokes once per tick.
 *   - This service does NOT touch Order/Payment/etc. tables.
 *     Every order found is funneled through
 *     MarketplaceImportService.processMarketplaceOrderEvent (C12.4),
 *     which owns idempotency + the createFromMarketplace handoff.
 *
 * Cursor:
 *   - SalesChannelConfig.settings.lastOrderPullAt (ISO-string)
 *   - First run: since = now - 24h
 *   - Subsequent: since = lastOrderPullAt - 5 min (overlap window)
 *   - Until: now snapshotted at tick-start, atomic across pages
 *   - Save: only on full successful completion (not on hard-cap break)
 *
 * Hard-rules:
 *   - Null touch on Orders/Payments/Invoices/Returns/Reservations/
 *     Inventory/Shipping/Finance/GoBD. Pure read-then-delegate.
 *   - Per-order try/catch: a single broken order MUST NOT abort
 *     the tick — failed++ counter, log, continue.
 *
 * FOR MARKETPLACE PULL — uses C12.4 Glue, never bypasses.
 */

import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'
import { resolveEbayEnv } from './ebay-env'
import {
  EbayAuthService,
  EbayNotConnectedError,
  EbayRefreshRevokedError,
} from './ebay-auth.service'
import { EbayApiClient } from './ebay-api.client'
import { AuditService } from '../../admin/services/audit.service'
import { MarketplaceImportService } from '../marketplace-import.service'
import type { MarketplaceImportEvent } from '../core/types'

// Tick-config constants — file-local for easy review.
const HARD_CAP_ORDERS_PER_TICK = 1000
const PAGE_LIMIT = 200 // eBay max
const INITIAL_LOOKBACK_MS = 24 * 60 * 60 * 1000 // 24h
const OVERLAP_WINDOW_MS = 5 * 60 * 1000 // 5 min

const AUDIT_ACTION_TICK_COMPLETED = 'MARKETPLACE_PULL_TICK_COMPLETED'

/**
 * Outcome of one runPullTick() invocation. Returned for tests +
 * smoke-script visibility. Cron wrapper logs it; no caller mutates.
 *
 * 3 states (K-1 confirmed):
 *   - completed: tick ran (with or without orders found, with or
 *     without hard-cap)
 *   - skipped_disconnected: pre-check found no active eBay connection
 *   - aborted_revoked: refresh-token revoked mid-tick — admin must
 *     reconnect (TokenRefreshCron already notifies)
 */
export interface PullTickSummary {
  status: 'completed' | 'skipped_disconnected' | 'aborted_revoked'
  since: string // ISO
  until: string // ISO
  found: number
  imported: number
  skipped: number
  failed: number
  durationMs: number
  hardCapHit: boolean
}

// eBay getOrders response shape — narrow, only the fields we use.
// Extra fields pass through into the per-order rawEventPayload.
interface EbayOrdersPage {
  total?: number
  offset?: number
  limit?: number
  next?: string
  orders?: Array<EbayOrderListItem>
}

interface EbayOrderListItem {
  orderId?: string
  legacyOrderId?: string
  [k: string]: unknown
}

@Injectable()
export class EbayOrderPullService {
  private readonly logger = new Logger(EbayOrderPullService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: EbayAuthService,
    private readonly importService: MarketplaceImportService,
    private readonly audit: AuditService,
  ) {}

  /**
   * One tick. Never throws on business outcomes — all results encoded
   * in the returned summary. The cron wrapper relies on this contract;
   * unexpected exceptions bubble to SafeCron for crash-event emission.
   */
  async runPullTick(): Promise<PullTickSummary> {
    const tickStart = Date.now()
    const until = new Date()

    // 1. Pre-check — if not connected, skip silently (but warn-log)
    const config = await this.prisma.salesChannelConfig.findUnique({
      where: { channel: 'ebay' },
      select: { isActive: true, accessToken: true, settings: true },
    })
    if (!config || !config.isActive || !config.accessToken) {
      this.logger.warn('[ebay-pull-cron] not connected — skip tick')
      return this.emptySummary('skipped_disconnected', until, until, tickStart)
    }

    // 2. Resolve `since` from cursor (or initial fallback)
    const settings = (config.settings ?? {}) as { lastOrderPullAt?: string }
    const since = this.resolveSince(settings.lastOrderPullAt, until)

    // 3. Get bearer (early-exit on auth errors)
    let bearer: string
    try {
      bearer = await this.auth.getAccessTokenOrRefresh()
    } catch (e) {
      if (e instanceof EbayRefreshRevokedError) {
        this.logger.warn('[ebay-pull-cron] aborted — refresh-token revoked')
        return this.emptySummary('aborted_revoked', since, until, tickStart)
      }
      if (e instanceof EbayNotConnectedError) {
        this.logger.warn(`[ebay-pull-cron] not connected: ${e.message}`)
        return this.emptySummary('skipped_disconnected', since, until, tickStart)
      }
      // Unknown — let SafeCron surface to Sentry
      throw e
    }

    // 4. Paginate getOrders within [since..until]
    const env = resolveEbayEnv()
    const client = new EbayApiClient(env)
    const counters = { imported: 0, skipped: 0, failed: 0 }
    let found = 0
    let hardCapHit = false
    let nextPath: string | null = this.buildInitialPath(since, until)

    while (nextPath !== null) {
      const page: EbayOrdersPage = await client.request<EbayOrdersPage>(
        'GET',
        nextPath,
        { bearer },
      )
      const orders = page.orders ?? []
      for (const order of orders) {
        if (found >= HARD_CAP_ORDERS_PER_TICK) {
          hardCapHit = true
          break
        }
        found++
        await this.processSingleOrder(order, counters)
      }
      if (hardCapHit) break
      // eBay's `next` is a fully-formed URL — strip the base for EbayApiClient
      nextPath = page.next ? this.toRelativePath(page.next, env.apiBaseUrl) : null
    }

    // 5. Advance cursor only if we did NOT hit the hard-cap
    if (!hardCapHit) {
      try {
        await this.auth.patchSettings({ lastOrderPullAt: until.toISOString() })
      } catch (e: any) {
        // Cursor save fail is recoverable — next tick re-pulls overlap window
        this.logger.error(`[ebay-pull-cron] cursor save failed: ${e?.message ?? e}`)
      }
    } else {
      this.logger.warn(
        `[ebay-pull-cron] HARD-CAP hit (${HARD_CAP_ORDERS_PER_TICK}) — cursor NOT advanced, next tick will catch up`,
      )
    }

    // 6. Build summary + audit (only if found > 0)
    const summary: PullTickSummary = {
      status: 'completed',
      since: since.toISOString(),
      until: until.toISOString(),
      found,
      imported: counters.imported,
      skipped: counters.skipped,
      failed: counters.failed,
      durationMs: Date.now() - tickStart,
      hardCapHit,
    }

    if (found > 0) {
      await this.audit
        .log({
          action: AUDIT_ACTION_TICK_COMPLETED,
          entityType: 'sales_channel_config',
          entityId: 'ebay',
          adminId: 'system',
          changes: { after: { ...summary } },
        })
        .catch((e: any) =>
          this.logger.warn(`[ebay-pull-cron] audit log failed: ${e?.message ?? e}`),
        )
    }

    this.logger.log(
      `[ebay-pull-cron] tick since=${summary.since} until=${summary.until} ` +
        `found=${found} imported=${counters.imported} skipped=${counters.skipped} ` +
        `failed=${counters.failed} duration_ms=${summary.durationMs}` +
        (hardCapHit ? ' HARD-CAP' : ''),
    )

    return summary
  }

  // ──────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────

  private resolveSince(cursorIso: string | undefined, until: Date): Date {
    if (!cursorIso) {
      return new Date(until.getTime() - INITIAL_LOOKBACK_MS)
    }
    const cursor = new Date(cursorIso)
    if (Number.isNaN(cursor.getTime())) {
      // Corrupted cursor → treat as initial run
      this.logger.warn(
        `[ebay-pull-cron] corrupted lastOrderPullAt='${cursorIso}', falling back to 24h initial`,
      )
      return new Date(until.getTime() - INITIAL_LOOKBACK_MS)
    }
    return new Date(cursor.getTime() - OVERLAP_WINDOW_MS)
  }

  private buildInitialPath(since: Date, until: Date): string {
    // eBay creationdate filter syntax: filter=creationdate:[<since>..<until>]
    // Both bounds are inclusive ISO-8601 with milliseconds.
    const filter = `creationdate:[${since.toISOString()}..${until.toISOString()}]`
    const params = new URLSearchParams({ filter, limit: String(PAGE_LIMIT) })
    return `/sell/fulfillment/v1/order?${params.toString()}`
  }

  private toRelativePath(absoluteNext: string, apiBaseUrl: string): string {
    // eBay returns full URL in `next` — strip the base for EbayApiClient
    if (absoluteNext.startsWith(apiBaseUrl)) {
      return absoluteNext.slice(apiBaseUrl.length)
    }
    // Defensive: if shape changes, log + use as-is (EbayApiClient will fail loud)
    this.logger.warn(`[ebay-pull-cron] unexpected next-link shape: ${absoluteNext}`)
    return absoluteNext
  }

  private async processSingleOrder(
    order: EbayOrderListItem,
    counters: { imported: number; skipped: number; failed: number },
  ): Promise<void> {
    const externalOrderId = (order.orderId ?? order.legacyOrderId ?? '').toString().trim()
    if (!externalOrderId) {
      counters.failed++
      this.logger.warn('[ebay-pull-cron] order has no orderId/legacyOrderId — skipping')
      return
    }
    const event: MarketplaceImportEvent = {
      marketplace: 'EBAY',
      externalOrderId,
      // No notification envelope on pull-source; the order itself is source-of-truth
      rawEventId: undefined,
      rawEventPayload: order,
      source: 'pull',
    }
    try {
      const outcome = await this.importService.processMarketplaceOrderEvent(event)
      if (outcome.status === 'imported') counters.imported++
      else if (outcome.status === 'skipped') counters.skipped++
      else counters.failed++
    } catch (e: any) {
      // Defensive — Glue should never throw on business outcomes, but
      // if anything bubbles (network, OOM, …) count as failed and continue.
      counters.failed++
      this.logger.error(
        `[ebay-pull-cron] order ${externalOrderId} threw unexpectedly: ${e?.message ?? e}`,
      )
    }
  }

  private emptySummary(
    status: PullTickSummary['status'],
    since: Date,
    until: Date,
    tickStart: number,
  ): PullTickSummary {
    return {
      status,
      since: since.toISOString(),
      until: until.toISOString(),
      found: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
      durationMs: Date.now() - tickStart,
      hardCapHit: false,
    }
  }
}
