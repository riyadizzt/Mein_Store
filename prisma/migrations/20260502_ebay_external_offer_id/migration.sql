-- C15.4.0 — Add externalOfferId column for eBay stock-push correctness.
--
-- Pure additive: nullable, no default. Existing rows stay NULL until
-- C15.4 backfill-script populates them from W3-verifier JSON
-- (/tmp/c154-production-verification-result.json, operator-only).
--
-- Cron-side WHERE-clause filters NOT NULL so unmapped legacy rows
-- are silently skipped until backfilled.
--
-- Idempotent via IF NOT EXISTS — re-run safe.
-- Daten-Verlust-Risiko: keine (kein DROP, kein UPDATE bestehender Daten).

ALTER TABLE "channel_product_listings"
  ADD COLUMN IF NOT EXISTS "external_offer_id" TEXT NULL;
