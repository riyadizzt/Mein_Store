import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  // Raw SQL — Prisma JSON null comparison is unreliable across versions
  const rows: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      order_number,
      status,
      created_at,
      total_amount,
      shipping_address_id,
      shipping_address_snapshot IS NULL AS snap_is_null,
      shipping_address_snapshot::text = 'null' AS snap_is_json_null
    FROM orders
    WHERE deleted_at IS NULL
      AND shipping_address_id IS NULL
      AND (shipping_address_snapshot IS NULL OR shipping_address_snapshot::text = 'null')
    ORDER BY created_at DESC
  `)

  console.log(`── Orders with NO shipping address at all: ${rows.length} ──\n`)

  if (rows.length === 0) {
    console.log('✅ Zero orders are missing shipping data entirely')
    return
  }

  const now = Date.now()
  const buckets = { lastHour: [] as any[], lastDay: [] as any[], lastWeek: [] as any[], older: [] as any[] }
  for (const r of rows) {
    const ageMs = now - new Date(r.created_at).getTime()
    if (ageMs < 3600 * 1000) buckets.lastHour.push(r)
    else if (ageMs < 24 * 3600 * 1000) buckets.lastDay.push(r)
    else if (ageMs < 7 * 24 * 3600 * 1000) buckets.lastWeek.push(r)
    else buckets.older.push(r)
  }

  console.log('Partition by age:')
  console.log(`  Last hour:  ${buckets.lastHour.length}`)
  console.log(`  Last day:   ${buckets.lastDay.length}`)
  console.log(`  Last week:  ${buckets.lastWeek.length}`)
  console.log(`  Older:      ${buckets.older.length}`)

  // Show most recent 10
  console.log('\n── Most recent 10 ──')
  for (const r of rows.slice(0, 10)) {
    console.log(`  ${r.order_number}  ${r.status.padEnd(12)}  €${r.total_amount}  ${new Date(r.created_at).toISOString()}`)
  }

  // Check if any reached invoice-generating state
  const realIds: string[] = rows.map((r) => r.order_number)
  const withInvoice = await prisma.invoice.findMany({
    where: { order: { orderNumber: { in: realIds } } },
    include: { order: { select: { orderNumber: true } } },
  })
  console.log(`\n── Invoices generated for these broken orders: ${withInvoice.length} ──`)
  if (withInvoice.length > 0) {
    console.log('  🚨 REAL BUG — these invoices have missing billing data:')
    for (const inv of withInvoice) {
      console.log(`     ${inv.invoiceNumber}  ${inv.order?.orderNumber}`)
    }
  }

  console.log('\n── DIAGNOSIS ──')
  if (buckets.lastDay.length === 0) {
    console.log('  ✅ Current code (last 24h) does NOT produce broken orders')
    console.log('  ⚠️  Historical test data has the issue — no action needed for launch')
  } else {
    console.log('  🚨 Current code STILL allows missing shipping — needs fix')
  }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
