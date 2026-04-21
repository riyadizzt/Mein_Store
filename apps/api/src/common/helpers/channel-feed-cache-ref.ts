/**
 * Module-level singleton reference to the active FeedsService instance.
 *
 * Why not DI
 * ──────────
 * AdminProductsService sits in AdminModule. FeedsModule imports
 * AdminModule to reach AuditService. If AdminModule ALSO imported
 * FeedsModule (to DI FeedsService into AdminProductsService) we'd get
 * a circular module dependency. To keep the architectural separation
 * clean (Working-rule #6 Harmony), we introduce a module-level ref
 * that FeedsService publishes itself to on bootstrap, and writers
 * consume via the `invalidateChannelFeedCache` helper.
 *
 * This is the exact mirror of how `revalidateProductTags` works —
 * a static helper function that side-channels work without wiring DI.
 *
 * Fire-and-forget contract
 * ───────────────────────
 *   - Writers call `invalidateChannelFeedCache()` WITHOUT awaiting
 *   - Errors inside cache.clearCache() are swallowed + logged
 *   - If FeedsService has not (yet) registered, the helper is a no-op
 *     → tests and cold-boot paths stay safe
 */

import { Logger } from '@nestjs/common'

// Structural type — identical contract as the existing helper. We
// intentionally accept `unknown` and duck-check `clearCache` so we
// don't need to import FeedsService from here (which would create a
// module dep we are trying to avoid).
interface Clearable {
  clearCache(): void
}

let activeRef: Clearable | null = null
const logger = new Logger('ChannelFeedCacheRef')

/**
 * Called exactly once, by FeedsService itself via OnModuleInit. Any
 * later call replaces the previous ref — safe because the old ref is
 * a GC candidate and clearCache() is idempotent. Tests that manually
 * construct FeedsService may register/unregister freely.
 */
export function registerChannelFeedCache(ref: Clearable | null): void {
  activeRef = ref
}

/**
 * Fire-and-forget. Writers (AdminProductsService, AdminController
 * updateProduct/updateSettings) call this after relevant mutations
 * so the public feed cache refreshes on the next crawler hit rather
 * than serving 30-min-stale data.
 */
export function invalidateChannelFeedCache(): void {
  const ref = activeRef
  if (!ref) return
  try {
    ref.clearCache()
  } catch (err: any) {
    // Non-fatal. The cache TTL of 30 min is the ultimate self-heal —
    // a missed invalidation just means crawlers see stale data for a
    // while. Log, do not re-throw; the writer's transaction is done.
    logger.warn(`invalidateChannelFeedCache() failed silently: ${err?.message ?? err}`)
  }
}
