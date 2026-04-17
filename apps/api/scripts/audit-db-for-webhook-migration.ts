/**
 * READ-ONLY DB audit before running the webhook migration.
 * Answers:
 *   1. What's in _prisma_migrations?
 *   2. For each of the 4 old migrations: does the target column/table already exist live?
 *   3. Does anything from the webhook migration already exist (would collide)?
 * Executes zero writes.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('\n═══ DB AUDIT — PRE-MIGRATION ═══\n')

  // ── 1. _prisma_migrations ───────────────────────────────
  console.log('── 1. _prisma_migrations table ──')
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
       FROM _prisma_migrations
       ORDER BY started_at ASC`,
    )
    if (rows.length === 0) {
      console.log('  (table is empty — no migrations tracked)')
    } else {
      for (const r of rows) {
        const status = r.rolled_back_at
          ? '🔴 ROLLED BACK'
          : r.finished_at
            ? '✅ applied'
            : '⚠️  started but not finished'
        console.log(`  ${status.padEnd(20)} ${r.migration_name}`)
      }
    }
  } catch (e: any) {
    if (/does not exist/i.test(e.message)) {
      console.log('  ❌ _prisma_migrations table does NOT exist in the DB')
    } else {
      console.log('  ❌ query failed:', e.message)
    }
  }

  // ── 2. Check each old migration's target ─────────────────
  console.log('\n── 2. Do the 4 old migrations targets already exist? ──')

  async function columnExists(table: string, column: string) {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      table,
      column,
    )
    return rows[0] ?? null
  }

  async function indexExists(name: string) {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
      name,
    )
    return rows.length > 0
  }

  async function constraintExists(table: string, name: string) {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT conname
       FROM pg_constraint c
       JOIN pg_class t ON c.conrelid = t.oid
       WHERE t.relname = $1 AND c.conname = $2`,
      table,
      name,
    )
    return rows.length > 0
  }

  // 20260408_add_shipping_address_snapshot
  {
    const col = await columnExists('orders', 'shipping_address_snapshot')
    console.log(`  [1] orders.shipping_address_snapshot: ${col ? `✅ EXISTS (${col.data_type})` : '❌ missing'}`)
  }
  // 20260413_inventory_check_constraints
  {
    const c1 = await constraintExists('inventory', 'inventory_quantity_on_hand_non_negative')
    const c2 = await constraintExists('inventory', 'inventory_quantity_reserved_non_negative')
    console.log(`  [2] inventory CHECK non_negative_on_hand:    ${c1 ? '✅ EXISTS' : '❌ missing'}`)
    console.log(`      inventory CHECK non_negative_reserved:   ${c2 ? '✅ EXISTS' : '❌ missing'}`)
  }
  // 20260413_payment_previous_provider_ids
  {
    const col = await columnExists('payments', 'previous_provider_payment_ids')
    const idx = await indexExists('payments_previous_provider_payment_ids_idx')
    console.log(`  [3] payments.previous_provider_payment_ids: ${col ? `✅ EXISTS (${col.data_type})` : '❌ missing'}`)
    console.log(`      GIN index:                               ${idx ? '✅ EXISTS' : '❌ missing'}`)
  }
  // 20260414_category_icon_key
  {
    const col = await columnExists('categories', 'icon_key')
    console.log(`  [4] categories.icon_key: ${col ? `✅ EXISTS (${col.data_type})` : '❌ missing'}`)
  }

  // ── 3. Collision check for the new webhook migration ─────
  console.log('\n── 3. Does anything from the NEW webhook migration already exist? ──')
  async function tableExists(name: string) {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1`,
      name,
    )
    return rows.length > 0
  }

  const t1 = await tableExists('webhook_subscriptions')
  const t2 = await tableExists('webhook_delivery_logs')
  console.log(`  webhook_subscriptions table:   ${t1 ? '🔴 COLLISION — already exists' : '✅ safe — does not exist'}`)
  console.log(`  webhook_delivery_logs table:   ${t2 ? '🔴 COLLISION — already exists' : '✅ safe — does not exist'}`)

  // ── 4. What does the migration SQL actually do? ──────────
  console.log('\n── 4. New migration SQL — scope summary ──')
  console.log('  CREATE TABLE "webhook_subscriptions"  (13 columns, PK on id)')
  console.log('  CREATE INDEX "webhook_subscriptions_is_active_idx"')
  console.log('  CREATE TABLE "webhook_delivery_logs"  (14 columns, PK on id)')
  console.log('  CREATE UNIQUE INDEX "webhook_delivery_logs_subscription_id_event_id_key"')
  console.log('  CREATE INDEX "webhook_delivery_logs_subscription_id_idx"')
  console.log('  CREATE INDEX "webhook_delivery_logs_status_idx"')
  console.log('  CREATE INDEX "webhook_delivery_logs_event_type_idx"')
  console.log('  CREATE INDEX "webhook_delivery_logs_created_at_idx"')
  console.log('  → 2 new tables, 6 new indexes. NO ALTER. NO DROP.')
  console.log('  → Touches ZERO existing tables.')

  console.log('\n═══ END AUDIT ═══\n')
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('Fatal:', e)
  prisma.$disconnect()
  process.exit(1)
})
