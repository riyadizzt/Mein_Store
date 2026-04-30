-- C15.0 — Inventory-sync columns + safety-stock default flip
--
-- Phase 2 marketplace-integration: stock-quantity push from Shop → eBay.
-- This migration adds the two state-columns used by the cron + listener
-- to detect drift idempotently, and flips safetyStock default 1 → 0 per
-- owner-decision.
--
-- last_synced_quantity → the EFFECTIVE quantity last reported to the
--                        marketplace (= max(0, available - safetyStock)).
--                        Cron pre-flight skips listings where the
--                        current effective quantity matches this value.
--                        NULL means "never pushed yet" → cron will
--                        push on first tick.
--
-- last_synced_at       → operational visibility ("synced 3min ago" in
--                        admin-UI), debugging-trail. ChannelProductListing
--                        already has a generic last_synced_at column
--                        (line 1079 in schema.prisma) used by C11
--                        publish-flow — but that field's semantic is
--                        "last time anything synced this listing"
--                        (price/title/quantity all updated at publish).
--                        The C15 push-flow piggy-backs on it: every
--                        successful quantity-push updates this single
--                        field, since "publish" is rare and "quantity-
--                        push" is frequent.
--                        ⇒ NO new column for last_synced_at — we reuse
--                          the existing one. Only last_synced_quantity
--                          is added.
--
-- safety_stock default → was 1 (C5 spec). Owner decision (G-5 in C15
--                        Phase B): flip to 0 for two reasons:
--                          (1) Many products carry only 1-2 units;
--                              safetyStock=1 at quantity=1 reports
--                              eBay-quantity=0 = lost sale.
--                          (2) Oversell-protection lives in 4 other
--                              layers (Listener fast-path, Reconcile-
--                              Cron, C5 Auto-Pause, C12.3 softStockCheck)
--                              — buffer is now opt-in, not default.
--                        Admin can manually raise per-listing as needed.
--
-- safety_stock backfill → ONLY rows currently at default-1 are flipped
--                        to 0. Rows with safety_stock=2 or higher are
--                        admin-explicit and MUST NOT be touched.
--
-- Pure additive migration:
--   - last_synced_quantity nullable
--   - safety_stock default change is metadata-only (DEFAULT clause)
--   - UPDATE only touches rows that match WHERE safety_stock = 1
--   - Idempotent (IF NOT EXISTS, conditional UPDATE) — safe to re-run
--
-- Hard-Rule compliance:
--   - C5 propagateChannelSafety() helper: ZERO TOUCH (only schema-
--     reads, no behavior change)
--   - Existing channel-listing rows: only those at default-1 are
--     touched, admin-overrides preserved
--   - Listing publish-flow (C11): UNCHANGED — this migration only
--     surfaces additional state for C15 reconcile

-- 1. Add the new tracking column.
ALTER TABLE "channel_product_listings"
  ADD COLUMN IF NOT EXISTS "last_synced_quantity" INTEGER NULL;

-- 2. Flip default for new rows: 1 → 0.
ALTER TABLE "channel_product_listings"
  ALTER COLUMN "safety_stock" SET DEFAULT 0;

-- 3. Backfill existing rows that are at the old default. Admin-set
--    values (>= 2) are intentionally preserved. Idempotent: re-run
--    finds no rows at safety_stock=1 the second time.
UPDATE "channel_product_listings"
  SET "safety_stock" = 0
  WHERE "safety_stock" = 1;
