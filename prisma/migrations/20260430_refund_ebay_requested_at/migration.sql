-- C13.3.0 — Add ebay_requested_at column to Refund table
--
-- Phase 2 marketplace-integration: eBay's issue_refund API returns
-- immediately with a refundId but the actual money-transfer happens
-- asynchronously inside eBay's processing. We poll for status changes
-- via EbayRefundPollService and use this timestamp to drive the
-- 48h-fallback admin-notification (S-5 decision).
--
-- Pure additive migration:
--   - Nullable column, non-destructive
--   - No other providers (Stripe/PayPal/Klarna/SumUp/Vorkasse) write here
--   - Existing refund rows keep ebay_requested_at = NULL
--
-- Hard-Rule compliance:
--   - Refund-row schema stays backwards-compatible
--   - PaymentsService.refund() ZERO TOUCH — the column is set
--     downstream in EbayPaymentProvider.refund() which returns the
--     value via RefundResult, but actual write is done by the poll
--     service or an updateMany after issue_refund success.

ALTER TABLE "refunds"
ADD COLUMN IF NOT EXISTS "ebay_requested_at" TIMESTAMP(3) NULL;
