-- C12.3a — Add 'ebay_managed_payments' to PaymentMethod enum
--
-- Phase 2 marketplace-integration: eBay-Orders are settled by eBay
-- Managed Payments. We record them in our Payment table with
-- provider='EBAY_MANAGED_PAYMENTS' (already in PaymentProvider enum
-- since C8) and need a corresponding PaymentMethod value.
--
-- Pure additive migration — extends existing enum, zero rows touched,
-- zero impact on shop / Stripe / PayPal / Klarna / SumUp / Vorkasse
-- payment flows. Postgres ALTER TYPE ADD VALUE is non-destructive.
-- Idempotent via IF NOT EXISTS — safe to re-run.

ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'ebay_managed_payments';
