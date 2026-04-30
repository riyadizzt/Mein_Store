-- C15.1.0 — Audit-tier classification + webhook idempotency
--
-- Three concerns combined in ONE atomic schema-commit (per
-- owner-decision H-2):
--
--   1. AuditTier enum (financial / operational / ephemeral)
--      + admin_audit_log.tier column @default(operational)
--      + (tier, created_at) composite index for cron-scan
--
--   2. marketplace_order_imports (marketplace, raw_event_id) UNIQUE
--      → blocks duplicate webhook deliveries at DB level. Postgres
--        NULL-semantics: each NULL row is distinct, so pull-cron
--        path (rawEventId=NULL) is unaffected.
--
--   3. Backfill of existing admin_audit_log rows:
--      → financial   for ~21 money-bearing actions (GoBD §147 AO)
--      → ephemeral   for high-volume noise events (eBay account
--                    deletions, webhook duplicates)
--      → operational for everything else (default — no UPDATE needed)
--      Chunked at 10.000 rows per UPDATE per owner-decision Q-3 to
--      avoid table-locks on large audit-log histories.
--
-- Hard-Rule compliance:
--   - Orders/Payments/Invoices/Returns: ZERO TOUCH
--   - AuditService.log() callers: ZERO TOUCH (auto-classification
--     in service code, separate C15.1 main commit)
--   - Existing admin_audit_log rows: only their `tier` column is
--     populated; `action` / `entity_type` / `changes` UNCHANGED.
--   - Pull-cron path (raw_event_id=NULL): unaffected by webhook
--     unique-index per Postgres NULL-distinctness.
--
-- Re-runnable: every step uses IF NOT EXISTS guards or idempotent
-- WHERE clauses. Backfill UPDATE is naturally idempotent — re-run
-- finds 0 rows where tier was already set correctly.

-- ─────────────────────────────────────────────────────────────────
-- 1. AuditTier enum + tier column on admin_audit_log
-- ─────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuditTier') THEN
    CREATE TYPE "AuditTier" AS ENUM ('financial', 'operational', 'ephemeral');
  END IF;
END$$;

ALTER TABLE "admin_audit_log"
  ADD COLUMN IF NOT EXISTS "tier" "AuditTier" NOT NULL DEFAULT 'operational';

CREATE INDEX IF NOT EXISTS "admin_audit_log_tier_created_at_idx"
  ON "admin_audit_log" ("tier", "created_at");

-- ─────────────────────────────────────────────────────────────────
-- 2. Webhook idempotency: marketplace_order_imports composite UNIQUE
-- ─────────────────────────────────────────────────────────────────

-- CREATE UNIQUE INDEX IF NOT EXISTS is supported. Index-name follows
-- the @@unique-name from schema.prisma so Prisma's introspection
-- picks up the existing index instead of generating a new one.
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_raw_event_unique"
  ON "marketplace_order_imports" ("marketplace", "raw_event_id");

-- ─────────────────────────────────────────────────────────────────
-- 3. Backfill — chunked 10.000 rows per UPDATE
-- ─────────────────────────────────────────────────────────────────
--
-- The action-lists below MUST stay in sync with FINANCIAL_ACTIONS +
-- EPHEMERAL_ACTIONS in apps/api/src/modules/admin/services/audit.service.ts.
-- A drift here means the cron will eventually delete a row whose
-- service-side classification was financial — i.e. permanent loss of
-- GoBD-relevant data. The C15.1 main commit adds a unit-test that
-- pins both lists together.

-- 3a. financial actions (GoBD §147 AO — NEVER deleted)
DO $$
DECLARE
  rows_affected INTEGER;
BEGIN
  LOOP
    UPDATE "admin_audit_log"
       SET "tier" = 'financial'::"AuditTier"
     WHERE "id" IN (
       SELECT "id" FROM "admin_audit_log"
        WHERE "tier" = 'operational'::"AuditTier"
          AND "action" IN (
            -- Invoices & Credit Notes
            'INVOICE_CREATED',
            'INVOICE_GENERATED',
            'MARKETPLACE_INVOICE_GENERATED',
            'CREDIT_NOTE_GENERATED',
            -- Payment lifecycle
            'PAYMENT_CREATED',
            'PAYMENT_CAPTURED',
            'PAYMENT_DISPUTED',
            -- Refund lifecycle (all providers)
            'REFUND_INITIATED',
            'REFUND_COMPLETED',
            'REFUND_FAILED',
            'EBAY_REFUND_COMPLETED',
            'EBAY_REFUND_FAILED',
            'EBAY_REFUND_PENDING_48H',
            'EBAY_REFUND_MANUALLY_CONFIRMED',
            'VORKASSE_REFUND_CONFIRMED',
            -- Money-bearing cancels
            'ORDER_CANCELLED_POST_PAYMENT',
            -- Return-flows that touch money
            'RETURN_REFUNDED',
            'RETURN_REFUND_FAILED',
            'PAYMENT_TIMEOUT_REFUNDED',
            -- Audit-archive itself (regulatory traceability)
            'AUDIT_ARCHIVE_COMPLETED',
            'AUDIT_ARCHIVE_FAILED'
          )
        LIMIT 10000
     );
    GET DIAGNOSTICS rows_affected = ROW_COUNT;
    RAISE NOTICE 'C15.1.0 backfill[financial]: % rows updated', rows_affected;
    EXIT WHEN rows_affected = 0;
  END LOOP;
END$$;

-- 3b. ephemeral actions (7-day retention, no R2 archive)
DO $$
DECLARE
  rows_affected INTEGER;
BEGIN
  LOOP
    UPDATE "admin_audit_log"
       SET "tier" = 'ephemeral'::"AuditTier"
     WHERE "id" IN (
       SELECT "id" FROM "admin_audit_log"
        WHERE "tier" = 'operational'::"AuditTier"
          AND "action" IN (
            'EBAY_ACCOUNT_DELETION_RECEIVED',
            'EBAY_WEBHOOK_DUPLICATE'
          )
        LIMIT 10000
     );
    GET DIAGNOSTICS rows_affected = ROW_COUNT;
    RAISE NOTICE 'C15.1.0 backfill[ephemeral]: % rows updated', rows_affected;
    EXIT WHEN rows_affected = 0;
  END LOOP;
END$$;

-- All other rows keep the default 'operational' tier — no UPDATE
-- needed (DEFAULT was applied during ADD COLUMN above).
