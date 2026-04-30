-- C14.0 — Add eBay tracking-push state columns to Shipment table
--
-- Phase 2 marketplace-integration: when a shipment is created for an
-- eBay-imported order, EbayShippingPushService pushes the tracking
-- number to eBay's POST /sell/fulfillment/v1/order/{id}/shipping_fulfillment
-- endpoint so the buyer sees the tracking in the eBay order details page.
--
-- ebay_pushed_at      → timestamp of successful push (success-marker, also
--                        idempotency-guard for cron retries)
-- ebay_push_attempts  → counter for max-retry-cap (5 attempts in 24h)
-- ebay_push_error     → last error message (NULL on success, last failure
--                        on cron-exhaustion so admin sees what failed)
--
-- Pure additive migration:
--   - All columns nullable (or default 0)
--   - Other shipments (Vorkasse-paid, POS, mobile, …) leave NULL
--   - Idempotent (`IF NOT EXISTS`) — safe to re-run
--
-- Hard-Rule compliance:
--   - shipments.service.createShipment() ZERO TOUCH (verified Phase A)
--   - DHL provider ZERO TOUCH
--   - Existing tracking-update flow UNCHANGED — these columns live
--     parallel to the existing shipment lifecycle.

ALTER TABLE "shipments"
  ADD COLUMN IF NOT EXISTS "ebay_pushed_at" TIMESTAMP(3) NULL,
  ADD COLUMN IF NOT EXISTS "ebay_push_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "ebay_push_error" TEXT NULL;
