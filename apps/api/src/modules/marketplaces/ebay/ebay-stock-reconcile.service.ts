/**
 * EbayStockReconcileService (C15).
 *
 * Cron-tick wrapper around EbayStockPushService.runReconcileTick that
 * adds the cron-specific concerns:
 *   - Single audit-summary row per tick (CHANNEL_STOCK_RECONCILE_TICK)
 *     written ONLY when the tick actually pushed something. Idle ticks
 *     don't pollute the audit log.
 *   - Structured tick-summary log line for ops observability.
 *   - Tick-level safety cap (max listings per tick).
 *
 * Why split out from EbayStockPushService
 * ───────────────────────────────────────
 * The push-service is shared between the listener fast-path and the
 * cron. The audit-summary "1 row per tick" semantic is cron-only —
 * the listener fast-path doesn't write audit on every push (would
 * be audit-spam at 1000s of rows/day). Keeping the cron-only
 * behavior in this thin wrapper preserves push-service single-
 * responsibility (push-and-persist) and keeps the cron-class itself
 * a 25-LoC thin SafeCron wrapper.
 *
 * Pattern: identical to C12.5 (EbayOrderPullService + Cron wrapper).
 */

import { Injectable, Logger } from '@nestjs/common'
import { EbayStockPushService, PushBatchResult } from './ebay-stock-push.service'
import { AuditService } from '../../admin/services/audit.service'

const RECONCILE_AUDIT_ACTION = 'CHANNEL_STOCK_RECONCILE_TICK'

/**
 * Soft cap on listings processed per tick. At 500 listings × 25/batch
 * = 20 batch-API-calls per tick. eBay daily-quota is 5000 calls/app
 * → 96 ticks/day × 20 calls = 1920 calls in worst case. Comfortable.
 */
const MAX_LISTINGS_PER_TICK = 500

@Injectable()
export class EbayStockReconcileService {
  private readonly logger = new Logger(EbayStockReconcileService.name)

  constructor(
    private readonly pushService: EbayStockPushService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Single tick. Never throws on business outcomes — push-service
   * already swallows them into the result. SafeCron decorator on the
   * cron-class handles unexpected throws (network OOM etc.) via
   * crash-event emission.
   */
  async runReconcileTick(): Promise<PushBatchResult> {
    const start = Date.now()
    const result = await this.pushService.runReconcileTick(MAX_LISTINGS_PER_TICK)
    const durationMs = Date.now() - start

    // Always log a structured tick-summary for ops visibility.
    this.logger.log(
      `[ebay-stock-reconcile] tick scanned=${result.scanned} pushed=${result.pushed} ` +
        `skipped=${result.skipped} failed=${result.failed} rateLimited=${result.rateLimited} ` +
        `durationMs=${durationMs}`,
    )

    // Audit only on non-idle ticks. Skipped-only ticks are normal
    // (no drift detected) and would just spam the audit log. Push
    // OR fail OR rate-limit are all worth recording.
    const hadActivity = result.pushed > 0 || result.failed > 0 || result.rateLimited
    if (hadActivity) {
      await this.audit
        .log({
          adminId: 'system',
          action: RECONCILE_AUDIT_ACTION,
          entityType: 'channel_listing',
          entityId: 'batch',
          changes: {
            after: {
              scanned: result.scanned,
              pushed: result.pushed,
              skipped: result.skipped,
              failed: result.failed,
              rateLimited: result.rateLimited,
              durationMs,
            },
          },
        })
        .catch((e: any) =>
          this.logger.warn(`[ebay-stock-reconcile] audit log failed: ${e?.message ?? e}`),
        )
    }

    return result
  }
}
