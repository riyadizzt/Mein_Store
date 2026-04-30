/**
 * Channel stock-push propagation helper (C15).
 *
 * Real-time fast-path companion to C5 (channel-safety-stock.ts).
 * Whenever a stock-mutation happens in the hot reservation/intake
 * paths, this helper fires a fire-and-forget push of the updated
 * effective quantity to every active marketplace listing for the
 * touched variants.
 *
 * Why a NEW helper instead of extending C5
 * ────────────────────────────────────────
 * C5's single responsibility is the auto-pause/auto-resume state
 * machine for channel listings. It must stay deterministic and
 * surgical — adding "and also push quantities to eBay" would (a)
 * mix two concerns into one launch-stable helper, (b) couple C5's
 * test surface to a brand-new defensive-multi-path eBay API, (c)
 * make a C15 outage able to break C5's pause-flow. Keeping the two
 * helpers parallel means each can fail independently, each has its
 * own ref-registration, each is unit-testable in isolation.
 *
 * Call pattern — fire-and-forget
 * ──────────────────────────────
 * Identical to C5: callers (ReservationService.reserve/confirm/
 * release/restock, AdminInventoryService.intake) invoke
 * `propagateChannelStockPush(prisma, variantIds)` without awaiting.
 * Errors are logged and swallowed — NEVER propagated back into the
 * caller's transaction. The reconcile-cron (15 min) is a safety
 * net for any stock-mutation path we don't explicitly hook.
 *
 * Cooperation with C5
 * ───────────────────
 * Both helpers are invoked from the same hook-sites. C5 runs first
 * (existing line). C15 runs second (new line). If C5 auto-pauses a
 * listing, the listing.status flips to 'paused' — and C15's pusher
 * sees status='paused' and skips the push (eBay would reject
 * pushing quantities for a paused listing anyway). This means: NO
 * race between pause-state and quantity-push; pause always wins.
 *
 * Mirrors the architectural pattern of channel-safety-stock.ts
 * (Phase-1 Arbeitsregel #6 harmony).
 */

import { Logger } from '@nestjs/common'

const logger = new Logger('ChannelStockPush')

/**
 * Structural surface that any concrete pusher (eBay, TikTok, …)
 * must satisfy. The helper itself is marketplace-agnostic — it
 * just hands variantIds to whatever pusher is registered.
 */
export interface ChannelStockPusher {
  /**
   * Push effective stock quantities for a set of variants to the
   * marketplace. Implementation MUST be idempotent (matching
   * lastSyncedQuantity is allowed to be a no-op) and MUST NOT
   * throw (errors logged + swallowed internally so a marketplace-
   * outage cannot break the caller's transaction).
   */
  pushForVariants: (variantIds: string[]) => Promise<void>
}

// ── Module-level singleton refs (mirror of C5 + channel-feed-cache-ref) ──
//
// ReservationService and AdminInventoryService sit in modules that
// can't cleanly import MarketplacesModule (where the eBay pusher
// lives) without DI cycles. A module-level ref lets them stay
// DI-free while still reaching the marketplace adapters when those
// modules register themselves at bootstrap.

let pusherRef: ChannelStockPusher | null = null

export function registerChannelStockPusher(ref: ChannelStockPusher | null): void {
  pusherRef = ref
}

/**
 * Test-only inspector — returns the currently-registered ref.
 * Useful for assertions in spec files. Not exported from any
 * runtime barrel.
 */
export function _getRegisteredPusher(): ChannelStockPusher | null {
  return pusherRef
}

/**
 * Fire-and-forget entry point for stock-mutation hot-paths.
 * Never awaited by the caller. Returns Promise<void> so callers
 * may attach `.catch(() => {})` for type-cleanliness.
 */
export async function propagateChannelStockPush(
  variantIds: string[],
): Promise<void> {
  if (!variantIds || variantIds.length === 0) return
  if (!pusherRef) {
    // Boot-order: hooks may fire before MarketplacesModule has
    // registered its pusher (e.g. during seed scripts). The
    // reconcile-cron will catch any drift on its next 15-min
    // tick. Debug-log so we have a breadcrumb if something
    // ever fires before bootstrap completes in prod.
    logger.debug(`no pusher registered — skipping push for ${variantIds.length} variant(s)`)
    return
  }
  try {
    // Dedup variantIds before handing them to the pusher (callers
    // may pass duplicates, e.g. cancelItems iterating per-line).
    const unique = Array.from(new Set(variantIds.filter((v) => typeof v === 'string')))
    if (unique.length === 0) return
    await pusherRef.pushForVariants(unique)
  } catch (err: any) {
    // Non-fatal. The reconcile-cron will catch any missed pushes
    // on its next 15-min sweep.
    logger.warn(`propagateChannelStockPush failed: ${err?.message ?? err}`)
  }
}
