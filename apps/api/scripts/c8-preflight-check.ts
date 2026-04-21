/**
 * C8 pre-flight check — verify migration assumptions against Live-DB
 * BEFORE applying. Read-only. Exits 1 if any assumption violated.
 */
import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()

async function main() {
  let fail = 0
  const ok = (m: string) => console.log(`✅ ${m}`)
  const bad = (m: string, x?: any) => { console.log(`🔴 ${m}`, x ?? ''); fail++ }

  // 1) ebay NOT in SalesChannel enum yet
  const salesCh = await p.$queryRawUnsafe<any[]>(`
    SELECT enumlabel FROM pg_enum
    WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'SalesChannel')
    ORDER BY enumsortorder`)
  const labels = salesCh.map((r: any) => r.enumlabel)
  labels.includes('ebay')
    ? bad('SalesChannel already contains ebay', labels)
    : ok(`SalesChannel does NOT yet contain 'ebay' (current: ${labels.join(',')})`)

  // 2) EBAY_MANAGED_PAYMENTS NOT in PaymentProvider yet
  const pp = await p.$queryRawUnsafe<any[]>(`
    SELECT enumlabel FROM pg_enum
    WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'PaymentProvider')
    ORDER BY enumsortorder`)
  const ppLabels = pp.map((r: any) => r.enumlabel)
  ppLabels.includes('EBAY_MANAGED_PAYMENTS')
    ? bad('PaymentProvider already contains EBAY_MANAGED_PAYMENTS', ppLabels)
    : ok(`PaymentProvider does NOT yet contain 'EBAY_MANAGED_PAYMENTS' (current: ${ppLabels.join(',')})`)

  // 3) marketplace_order_imports table does not exist
  const tbl = await p.$queryRawUnsafe<any[]>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'marketplace_order_imports'`)
  tbl.length === 0
    ? ok('marketplace_order_imports table does not exist yet')
    : bad('marketplace_order_imports already exists!', tbl)

  // 4) Marketplace + MarketplaceImportStatus enums do not exist
  const enums = await p.$queryRawUnsafe<any[]>(`
    SELECT typname FROM pg_type
    WHERE typname IN ('Marketplace', 'MarketplaceImportStatus')`)
  enums.length === 0
    ? ok('Marketplace + MarketplaceImportStatus enums do not exist yet')
    : bad('One or both marketplace enums already exist', enums)

  // 5) No existing orders with channel_order_id duplicates (partial-unique safe)
  const dups = await p.$queryRawUnsafe<any[]>(`
    SELECT channel, channel_order_id, COUNT(*)::int AS n
    FROM orders
    WHERE channel_order_id IS NOT NULL
    GROUP BY channel, channel_order_id
    HAVING COUNT(*) > 1`)
  dups.length === 0
    ? ok('No duplicate (channel, channel_order_id) pairs in orders — partial-unique safe')
    : bad(`Found ${dups.length} duplicate pairs — partial-unique would fail!`, dups)

  // 6) No orders with channel='ebay' (enum didn't contain it)
  const ebayOrders = await p.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*)::int AS n FROM orders WHERE channel::text = 'ebay'`)
  Number(ebayOrders[0].n) === 0
    ? ok(`Zero orders with channel='ebay' (as expected)`)
    : bad(`Found ${ebayOrders[0].n} orders with channel='ebay' — impossible pre-migration!`)

  // 7) Existing orders with channel_order_id NOT NULL (what's there already?)
  const prevMkplOrders = await p.$queryRawUnsafe<any[]>(`
    SELECT channel, COUNT(*)::int AS n
    FROM orders
    WHERE channel_order_id IS NOT NULL
    GROUP BY channel
    ORDER BY n DESC`)
  console.log(`\n   Orders with channel_order_id already set (informational):`)
  if (prevMkplOrders.length === 0) console.log('   (none)')
  else prevMkplOrders.forEach((r: any) => console.log(`   ${r.channel}: ${r.n}`))

  console.log(`\n=== Pre-flight ${fail === 0 ? 'PASS' : 'FAIL'}: ${fail} blocker${fail === 1 ? '' : 's'} ===`)
  await p.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(2) })
