/**
 * Channel safety-stock propagation helper (C5).
 *
 * What it does
 * ────────────
 * For each given variant, look at all ChannelProductListing rows
 * attached to it, and decide — based on the variant's current
 * available stock versus the listing's per-channel safetyStock
 * threshold — whether the listing should be auto-paused or auto-
 * resumed.
 *
 * Availability formula (user Q2 — aligned with Cart / Feed semantics)
 * ──────────────────────────────────────────────────────────────────
 *   availableStock = max_over_warehouses(quantityOnHand - quantityReserved)
 *
 * Not SUM — because a cart line is fulfilled from a single warehouse,
 * and eBay / TikTok listings will only be able to sell what one
 * warehouse actually holds. Matches products-stock-semantics.spec.ts
 * and the pre-existing feed reader.
 *
 * Transition rules (user Q4 + Q5)
 * ───────────────────────────────
 *   status='active' / 'pending' AND available <= safetyStock
 *     →  status='paused', pauseReason='low_stock', pausedAt=now
 *        + 1 admin notification per listing ('channel_auto_paused')
 *
 *   status='paused' AND pauseReason='low_stock' AND available > safetyStock
 *     →  status='active', pauseReason=null, pausedAt=null
 *        (pauseReason='manual' is NEVER auto-resumed — only admin action)
 *
 * External API side-effects are explicitly OUT OF SCOPE in C5
 * (user Q4(a)). Adapters land in Phase 2 (eBay) and Phase 3 (TikTok).
 *
 * Call pattern — fire-and-forget
 * ──────────────────────────────
 *   Callers (ReservationService.reserve/confirm/release/restock,
 *   AdminInventoryService.intake) invoke `propagateChannelSafety(...)`
 *   without awaiting, passing the variant IDs they just touched. Errors
 *   are logged and swallowed — NEVER propagated back into the caller's
 *   transaction.
 *
 * Mirrors the exact shape of `revalidateProductTags` and
 * `invalidateChannelFeedCache` (Phase-1 Arbeitsregel #6 harmony).
 */

import { Logger } from '@nestjs/common'

// Structural types — duck-typed so we don't pull in any concrete
// Prisma client from this helper (avoids a module-import web).
export interface SafetyPrismaClient {
  inventory: {
    // Return type is `Promise<any[]>` so real Prisma clients (whose
    // findMany returns a richer row shape) remain assignable to this
    // structural interface. We read only 3 fields.
    findMany: (args: any) => Promise<any[]>
  }
  channelProductListing: {
    findMany: (args: any) => Promise<any[]>
    update: (args: any) => Promise<any>
  }
  product: {
    findUnique: (args: any) => Promise<any | null>
  }
}

export interface SafetyNotifier {
  createForAllAdmins: (data: {
    type: string
    title: string
    body: string
    entityType?: string
    entityId?: string
    data?: any
  }) => Promise<unknown>
}

export interface SafetyAuditor {
  log: (data: {
    action: string
    entityType: string
    entityId: string
    changes: any
    // 'system' is the project-wide sentinel for non-user-triggered
    // actions (see payment-timeout.cron, maintenance.service).
    adminId: string
    ipAddress?: string
  }) => Promise<unknown>
}

const logger = new Logger('ChannelSafetyStock')

export interface SafetyCheckResult {
  paused: number
  resumed: number
  skipped: number
}

/**
 * Compute availableStock for a variant using max-per-warehouse
 * semantics. Split out as a pure function for direct unit-testing.
 */
export function computeAvailableStock(
  rows: Array<{ quantityOnHand: number; quantityReserved: number }>,
): number {
  if (!rows || rows.length === 0) return 0
  return rows.reduce((max, r) => {
    const avail = Math.max(0, r.quantityOnHand - r.quantityReserved)
    return avail > max ? avail : max
  }, 0)
}

/**
 * Pure decision function: given current listing state + available
 * stock, return the next state or `null` if nothing should change.
 * Tested directly, no DB mocks needed.
 */
export function decideSafetyTransition(
  listing: { status: string; pauseReason: string | null; safetyStock: number },
  availableStock: number,
): { nextStatus: 'paused' | 'active'; reason: 'low_stock' | null } | null {
  // Auto-pause: active-ish listing dropped to/below threshold
  if (
    (listing.status === 'active' || listing.status === 'pending') &&
    availableStock <= listing.safetyStock
  ) {
    return { nextStatus: 'paused', reason: 'low_stock' }
  }
  // Auto-resume: only for 'low_stock' pauses — NEVER for 'manual'
  if (
    listing.status === 'paused' &&
    listing.pauseReason === 'low_stock' &&
    availableStock > listing.safetyStock
  ) {
    return { nextStatus: 'active', reason: null }
  }
  // No transition
  return null
}

/**
 * Apply safety-stock logic to a set of variants. Fire-and-forget at
 * callsites — wraps all work in try/catch internally so nothing
 * propagates back to the reservation transaction.
 *
 * Returns a result summary for the self-healing cron (which wants to
 * know "how many flips this sweep produced"). Callers in the
 * reservation hot-path just await-and-swallow via `.catch(() => {})`.
 */
export async function propagateChannelSafety(
  prisma: SafetyPrismaClient,
  variantIds: string[],
  notifier?: SafetyNotifier | null,
  auditor?: SafetyAuditor | null,
): Promise<SafetyCheckResult> {
  const result: SafetyCheckResult = { paused: 0, resumed: 0, skipped: 0 }
  if (!variantIds || variantIds.length === 0) return result

  try {
    // 1. Pull current listings for these variants — only rows that
    //    could change (active / pending / paused[low_stock]). Rows
    //    with status='deleted' or 'rejected' are out of scope.
    const listings = await prisma.channelProductListing.findMany({
      where: {
        variantId: { in: variantIds },
        OR: [
          { status: 'active' },
          { status: 'pending' },
          { status: 'paused', pauseReason: 'low_stock' },
        ],
      },
    })
    if (listings.length === 0) return result

    // 2. Pull all inventory rows for the affected variants in one
    //    query. Map them by variantId for fast lookup.
    const inventoryRows = await prisma.inventory.findMany({
      where: { variantId: { in: variantIds } },
      // No select — the helper's structural type accepts any subset;
      // we use the 3 fields we care about below.
    })
    const inventoryByVariant = new Map<string, Array<{ quantityOnHand: number; quantityReserved: number }>>()
    for (const row of inventoryRows) {
      const list = inventoryByVariant.get(row.variantId) ?? []
      list.push({ quantityOnHand: row.quantityOnHand, quantityReserved: row.quantityReserved })
      inventoryByVariant.set(row.variantId, list)
    }

    // 3. For each listing, decide + apply transition.
    for (const listing of listings) {
      if (!listing.variantId) { result.skipped++; continue }
      const rows = inventoryByVariant.get(listing.variantId) ?? []
      const available = computeAvailableStock(rows)

      const decision = decideSafetyTransition(listing, available)
      if (!decision) { result.skipped++; continue }

      // Apply DB update — in isolation (no outer transaction).
      // Concurrent hits on the same listing are safe: worst case the
      // cron and the event-path both compute the same decision; the
      // second update becomes a no-op-shaped write that Postgres
      // tolerates.
      await prisma.channelProductListing.update({
        where: { id: listing.id },
        data: {
          status: decision.nextStatus as any,
          pauseReason: decision.reason,
          pausedAt: decision.nextStatus === 'paused' ? new Date() : null,
          autoResumeAt: null, // reserved for future scheduled-resume feature
        },
      })

      if (decision.nextStatus === 'paused') {
        result.paused++
        // Fetch product name for the notification body (best-effort).
        // `as any` to bypass Prisma's generic-return-type inference —
        // this helper is structurally-typed and doesn't know about the
        // full Product shape. We only read 2 fields.
        let product: { id: string; translations: Array<{ language: string; name: string }> } | null = null
        try {
          product = await (prisma.product.findUnique as any)({
            where: { id: listing.productId },
            select: { id: true, translations: { select: { language: true, name: true } } },
          })
        } catch { /* best-effort */ }
        const dename = product?.translations.find((t) => t.language === 'de')?.name
          ?? product?.translations[0]?.name
          ?? listing.productId

        if (notifier) {
          await notifier.createForAllAdmins({
            type: 'channel_auto_paused',
            title: 'Channel-Listing pausiert',
            body: `${dename} auf ${listing.channel}: Bestand unter Safety-Stock (${listing.safetyStock}). Automatisch pausiert.`,
            entityType: 'product',
            entityId: listing.productId,
            data: { channel: listing.channel, safetyStock: listing.safetyStock, available },
          }).catch((err: any) => logger.warn(`notify failed: ${err?.message ?? err}`))
        }
        if (auditor) {
          await auditor.log({
            action: 'CHANNEL_LISTING_AUTO_PAUSED',
            entityType: 'product',
            entityId: listing.productId,
            changes: { after: { channel: listing.channel, reason: 'low_stock', available, threshold: listing.safetyStock } },
            adminId: 'system',
          }).catch(() => {})
        }
      } else {
        result.resumed++
        if (auditor) {
          await auditor.log({
            action: 'CHANNEL_LISTING_AUTO_RESUMED',
            entityType: 'product',
            entityId: listing.productId,
            changes: { after: { channel: listing.channel, available, threshold: listing.safetyStock } },
            adminId: 'system',
          }).catch(() => {})
        }
      }
    }
  } catch (err: any) {
    // Non-fatal. The self-healing cron (5 min) will reconcile any
    // missed transitions on the next pass.
    logger.warn(`propagateChannelSafety failed: ${err?.message ?? err}`)
  }

  return result
}

// ── Module-level singleton refs (mirror of channel-feed-cache-ref) ──
//
// Same architectural pattern as for the feed cache: ReservationService
// and AdminInventoryService sit in modules that CAN'T cleanly import
// AdminModule (AuditService + NotificationService) without cycles. A
// module-level ref lets them stay DI-free while still reaching the
// admin-side services when those modules register themselves.

let notifierRef: SafetyNotifier | null = null
let auditorRef: SafetyAuditor | null = null

export function registerChannelSafetyNotifier(ref: SafetyNotifier | null): void {
  notifierRef = ref
}
export function registerChannelSafetyAuditor(ref: SafetyAuditor | null): void {
  auditorRef = ref
}

/**
 * Fire-and-forget entry point for ReservationService /
 * AdminInventoryService. Never awaited by the caller.
 */
export function propagateChannelSafetyCheck(
  prisma: SafetyPrismaClient,
  variantIds: string[],
): Promise<SafetyCheckResult> {
  return propagateChannelSafety(prisma, variantIds, notifierRef, auditorRef)
}
