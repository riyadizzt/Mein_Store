import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  // Use the exact dashboard query, without LIMIT
  const rows: any[] = await prisma.$queryRaw`
    SELECT i.warehouse_id, COUNT(*)::int as n, w.name as wh, w.is_default
    FROM inventory i
    JOIN product_variants pv ON pv.id = i.variant_id
    JOIN products p ON p.id = pv.product_id
    JOIN warehouses w ON w.id = i.warehouse_id
    WHERE (i.quantity_on_hand - i.quantity_reserved) <= i.reorder_point
    GROUP BY i.warehouse_id, w.name, w.is_default
    ORDER BY n DESC
  `
  console.log(`\n  Low-stock breakdown by warehouse:`)
  let total = 0
  for (const r of rows) {
    console.log(`    ${r.wh.padEnd(22)} ${r.is_default ? '(DEFAULT)' : '(other)  '} ${String(r.n).padStart(5)} rows`)
    total += r.n
  }
  console.log(`  TOTAL: ${total}`)
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
