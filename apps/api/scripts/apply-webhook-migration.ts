/**
 * Apply pending migrations in a SINGLE TRANSACTION.
 * If ANY statement fails, all roll back together — no half-state.
 *
 * Blocks:
 *   A) Inventory CHECK constraints (3 x ADD + 3 x VALIDATE)
 *   B) GIN index on payments.previous_provider_payment_ids
 *   C) webhook_subscriptions + webhook_delivery_logs tables + 6 indexes
 *
 * Pre-check done separately (audit-inventory-integrity.ts: 0 violations).
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('\n═══ APPLY MIGRATION (TRANSACTION) ═══\n')

  // Pre-snapshot for verification later
  const preCounts = await prisma.$queryRawUnsafe<any[]>(
    `SELECT
       (SELECT COUNT(*)::int FROM orders)      AS orders,
       (SELECT COUNT(*)::int FROM inventory)   AS inventory,
       (SELECT COUNT(*)::int FROM payments)    AS payments,
       (SELECT COUNT(*)::int FROM categories)  AS categories,
       (SELECT COUNT(*)::int FROM users)       AS users,
       (SELECT COUNT(*)::int FROM products)    AS products`,
  )
  console.log('Pre-counts:', preCounts[0])

  const startTime = Date.now()

  await prisma.$transaction(async (tx) => {
    console.log('\n── Block A: inventory CHECK constraints ──')

    await tx.$executeRawUnsafe(`
      ALTER TABLE inventory
        ADD CONSTRAINT inventory_quantity_on_hand_non_negative
        CHECK (quantity_on_hand >= 0) NOT VALID
    `)
    console.log('  ✅ ADD inventory_quantity_on_hand_non_negative (NOT VALID)')

    await tx.$executeRawUnsafe(`
      ALTER TABLE inventory
        VALIDATE CONSTRAINT inventory_quantity_on_hand_non_negative
    `)
    console.log('  ✅ VALIDATE inventory_quantity_on_hand_non_negative')

    await tx.$executeRawUnsafe(`
      ALTER TABLE inventory
        ADD CONSTRAINT inventory_quantity_reserved_non_negative
        CHECK (quantity_reserved >= 0) NOT VALID
    `)
    console.log('  ✅ ADD inventory_quantity_reserved_non_negative (NOT VALID)')

    await tx.$executeRawUnsafe(`
      ALTER TABLE inventory
        VALIDATE CONSTRAINT inventory_quantity_reserved_non_negative
    `)
    console.log('  ✅ VALIDATE inventory_quantity_reserved_non_negative')

    await tx.$executeRawUnsafe(`
      ALTER TABLE inventory
        ADD CONSTRAINT inventory_reserved_lte_on_hand
        CHECK (quantity_reserved <= quantity_on_hand) NOT VALID
    `)
    console.log('  ✅ ADD inventory_reserved_lte_on_hand (NOT VALID)')

    await tx.$executeRawUnsafe(`
      ALTER TABLE inventory
        VALIDATE CONSTRAINT inventory_reserved_lte_on_hand
    `)
    console.log('  ✅ VALIDATE inventory_reserved_lte_on_hand')

    console.log('\n── Block B: GIN index on payments ──')
    await tx.$executeRawUnsafe(`
      CREATE INDEX payments_previous_provider_payment_ids_idx
        ON payments USING GIN (previous_provider_payment_ids)
    `)
    console.log('  ✅ CREATE INDEX payments_previous_provider_payment_ids_idx')

    console.log('\n── Block C: webhook tables ──')

    await tx.$executeRawUnsafe(`
      CREATE TABLE "webhook_subscriptions" (
        "id"                   TEXT NOT NULL,
        "url"                  TEXT NOT NULL,
        "secret"               TEXT NOT NULL,
        "events"               TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        "is_active"            BOOLEAN NOT NULL DEFAULT true,
        "description"          TEXT,
        "total_deliveries"     INTEGER NOT NULL DEFAULT 0,
        "total_successes"      INTEGER NOT NULL DEFAULT 0,
        "total_failures"       INTEGER NOT NULL DEFAULT 0,
        "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
        "last_delivery_at"     TIMESTAMP(3),
        "last_success_at"      TIMESTAMP(3),
        "last_failure_at"      TIMESTAMP(3),
        "created_by"           TEXT,
        "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at"           TIMESTAMP(3) NOT NULL,
        CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
      )
    `)
    console.log('  ✅ CREATE TABLE webhook_subscriptions')

    await tx.$executeRawUnsafe(`
      CREATE INDEX "webhook_subscriptions_is_active_idx"
        ON "webhook_subscriptions"("is_active")
    `)
    console.log('  ✅ CREATE INDEX webhook_subscriptions_is_active_idx')

    await tx.$executeRawUnsafe(`
      CREATE TABLE "webhook_delivery_logs" (
        "id"              TEXT NOT NULL,
        "subscription_id" TEXT NOT NULL,
        "event_type"      TEXT NOT NULL,
        "event_id"        TEXT NOT NULL,
        "payload"         JSONB NOT NULL,
        "status"          TEXT NOT NULL DEFAULT 'pending',
        "http_status"     INTEGER,
        "response_body"   TEXT,
        "error_message"   TEXT,
        "attempt_count"   INTEGER NOT NULL DEFAULT 0,
        "next_attempt_at" TIMESTAMP(3),
        "last_attempt_at" TIMESTAMP(3),
        "completed_at"    TIMESTAMP(3),
        "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "webhook_delivery_logs_pkey" PRIMARY KEY ("id")
      )
    `)
    console.log('  ✅ CREATE TABLE webhook_delivery_logs')

    await tx.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "webhook_delivery_logs_subscription_id_event_id_key"
        ON "webhook_delivery_logs"("subscription_id", "event_id")
    `)
    console.log('  ✅ CREATE UNIQUE INDEX webhook_delivery_logs_subscription_id_event_id_key')

    await tx.$executeRawUnsafe(`
      CREATE INDEX "webhook_delivery_logs_subscription_id_idx"
        ON "webhook_delivery_logs"("subscription_id")
    `)
    console.log('  ✅ CREATE INDEX webhook_delivery_logs_subscription_id_idx')

    await tx.$executeRawUnsafe(`
      CREATE INDEX "webhook_delivery_logs_status_idx"
        ON "webhook_delivery_logs"("status")
    `)
    console.log('  ✅ CREATE INDEX webhook_delivery_logs_status_idx')

    await tx.$executeRawUnsafe(`
      CREATE INDEX "webhook_delivery_logs_event_type_idx"
        ON "webhook_delivery_logs"("event_type")
    `)
    console.log('  ✅ CREATE INDEX webhook_delivery_logs_event_type_idx')

    await tx.$executeRawUnsafe(`
      CREATE INDEX "webhook_delivery_logs_created_at_idx"
        ON "webhook_delivery_logs"("created_at")
    `)
    console.log('  ✅ CREATE INDEX webhook_delivery_logs_created_at_idx')
  }, { timeout: 60000 })

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
  console.log(`\n✅ Transaction committed in ${elapsed}s`)

  // Post-snapshot
  const postCounts = await prisma.$queryRawUnsafe<any[]>(
    `SELECT
       (SELECT COUNT(*)::int FROM orders)      AS orders,
       (SELECT COUNT(*)::int FROM inventory)   AS inventory,
       (SELECT COUNT(*)::int FROM payments)    AS payments,
       (SELECT COUNT(*)::int FROM categories)  AS categories,
       (SELECT COUNT(*)::int FROM users)       AS users,
       (SELECT COUNT(*)::int FROM products)    AS products`,
  )
  console.log('\nPost-counts:', postCounts[0])

  const pre = preCounts[0]
  const post = postCounts[0]
  const sameRows =
    pre.orders === post.orders &&
    pre.inventory === post.inventory &&
    pre.payments === post.payments &&
    pre.categories === post.categories &&
    pre.users === post.users &&
    pre.products === post.products
  console.log(`Row counts unchanged: ${sameRows ? '✅' : '🔴 MISMATCH'}`)
  if (!sameRows) process.exit(1)

  console.log('\n═══ DONE ═══\n')
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('\n🔴 Transaction FAILED — rolled back, no changes applied:')
  console.error(e)
  prisma.$disconnect()
  process.exit(1)
})
