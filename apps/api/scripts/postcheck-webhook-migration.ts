/**
 * READ-ONLY post-check after webhook migration.
 * Verifies:
 *   - All 3 inventory CHECK constraints exist
 *   - GIN index on payments exists
 *   - Both webhook tables exist and are EMPTY (0 rows)
 *   - _prisma_migrations has 5 rows, all with finished_at set
 *   - Row counts on existing tables are unchanged from pre-migration snapshot
 *   - Schema still matches app expectations (prisma client can SELECT from key tables)
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('\n═══ POST-CHECK ═══\n')

  // ── Inventory constraints ──
  const constraints = await prisma.$queryRawUnsafe<any[]>(
    `SELECT conname FROM pg_constraint c
     JOIN pg_class t ON c.conrelid = t.oid
     WHERE t.relname = 'inventory' AND c.conname LIKE 'inventory_%'`,
  )
  const cNames = constraints.map((r) => r.conname).sort()
  console.log('Inventory constraints:', cNames)
  const expected = [
    'inventory_quantity_on_hand_non_negative',
    'inventory_quantity_reserved_non_negative',
    'inventory_reserved_lte_on_hand',
  ]
  for (const e of expected) {
    console.log(`  ${cNames.includes(e) ? '✅' : '🔴 MISSING'} ${e}`)
  }

  // ── GIN index ──
  const idx = await prisma.$queryRawUnsafe<any[]>(
    `SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'payments_previous_provider_payment_ids_idx'`,
  )
  console.log('\nGIN index on payments:')
  if (idx.length > 0) {
    console.log('  ✅ exists:', idx[0].indexdef)
  } else {
    console.log('  🔴 MISSING')
  }

  // ── Webhook tables exist + empty ──
  const wsubs = await prisma.webhookSubscription.findMany()
  const wlogs = await prisma.webhookDeliveryLog.findMany()
  console.log('\nWebhook tables:')
  console.log(`  webhook_subscriptions:  ${wsubs.length === 0 ? '✅ empty (0 rows)' : `🔴 has ${wsubs.length} rows`}`)
  console.log(`  webhook_delivery_logs:  ${wlogs.length === 0 ? '✅ empty (0 rows)' : `🔴 has ${wlogs.length} rows`}`)

  // ── _prisma_migrations ──
  const migs = await prisma.$queryRawUnsafe<any[]>(
    `SELECT migration_name, finished_at, rolled_back_at
     FROM _prisma_migrations
     ORDER BY started_at ASC`,
  )
  console.log(`\n_prisma_migrations (${migs.length} rows):`)
  for (const m of migs) {
    const status = m.rolled_back_at ? '🔴 ROLLED BACK' : m.finished_at ? '✅ applied' : '🔴 unfinished'
    console.log(`  ${status.padEnd(20)} ${m.migration_name}`)
  }
  if (migs.length !== 5) console.log(`  🔴 expected 5 rows, got ${migs.length}`)

  // ── Critical-table row counts (must match pre-migration) ──
  const counts = await prisma.$queryRawUnsafe<any[]>(
    `SELECT
       (SELECT COUNT(*)::int FROM orders)      AS orders,
       (SELECT COUNT(*)::int FROM inventory)   AS inventory,
       (SELECT COUNT(*)::int FROM payments)    AS payments,
       (SELECT COUNT(*)::int FROM categories)  AS categories,
       (SELECT COUNT(*)::int FROM users)       AS users,
       (SELECT COUNT(*)::int FROM products)    AS products,
       (SELECT COUNT(*)::int FROM product_variants) AS product_variants,
       (SELECT COUNT(*)::int FROM shop_settings) AS shop_settings`,
  )
  console.log('\nRow counts:', counts[0])
  // Expected (from pre-snapshot): orders=259, inventory=555, payments=217, categories=60, users=64, products=118
  const expectedCounts = { orders: 259, inventory: 555, payments: 217, categories: 60, users: 64, products: 118 }
  let mismatch = false
  for (const [k, v] of Object.entries(expectedCounts)) {
    if ((counts[0] as any)[k] !== v) {
      console.log(`  🔴 ${k}: expected ${v}, got ${(counts[0] as any)[k]}`)
      mismatch = true
    }
  }
  if (!mismatch) console.log('  ✅ All row counts match pre-migration snapshot')

  // ── Smoke test: can we still SELECT from key tables via Prisma client? ──
  console.log('\nPrisma client smoke tests:')
  const firstOrder = await prisma.order.findFirst({ select: { id: true, orderNumber: true } })
  console.log(`  order.findFirst: ${firstOrder ? '✅' : '🔴'} ${firstOrder?.orderNumber ?? 'n/a'}`)
  const firstProduct = await prisma.product.findFirst({ select: { id: true, slug: true } })
  console.log(`  product.findFirst: ${firstProduct ? '✅' : '🔴'} ${firstProduct?.slug ?? 'n/a'}`)
  const firstPayment = await prisma.payment.findFirst({ select: { id: true, provider: true, previousProviderPaymentIds: true } })
  console.log(`  payment.findFirst (with new field): ${firstPayment ? '✅' : '🔴'} ${firstPayment?.provider ?? 'n/a'}, previousIds=${JSON.stringify(firstPayment?.previousProviderPaymentIds ?? [])}`)
  const firstInventory = await prisma.inventory.findFirst({ select: { id: true, quantityOnHand: true, quantityReserved: true } })
  console.log(`  inventory.findFirst: ${firstInventory ? '✅' : '🔴'} onHand=${firstInventory?.quantityOnHand}, reserved=${firstInventory?.quantityReserved}`)

  console.log('\n═══ DONE ═══\n')
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('Fatal:', e)
  prisma.$disconnect()
  process.exit(1)
})
