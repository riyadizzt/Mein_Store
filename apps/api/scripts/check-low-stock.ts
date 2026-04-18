import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  // Low-Stock Logic: onHand - reserved <= reorderPoint
  const lowStock = await prisma.$queryRaw<any[]>`
    SELECT pv.sku, i.quantity_on_hand, i.quantity_reserved, i.reorder_point, w.name as warehouse
    FROM inventory i
    JOIN product_variants pv ON pv.id = i.variant_id
    JOIN products p ON p.id = pv.product_id
    JOIN warehouses w ON w.id = i.warehouse_id
    WHERE (i.quantity_on_hand - i.quantity_reserved) <= i.reorder_point
      AND i.reorder_point > 0
      AND p.deleted_at IS NULL
      AND p.is_active = true
      AND pv.is_active = true
  `
  console.log(`\n  Low-stock items: ${lowStock.length}\n`)
  for (const r of lowStock.slice(0, 10)) {
    console.log(`    ${r.sku.padEnd(22)}  onHand=${r.quantity_on_hand}  reserved=${r.quantity_reserved}  reorder=${r.reorder_point}  (${r.warehouse})`)
  }
  if (lowStock.length > 10) console.log(`    ... + ${lowStock.length - 10} weitere`)

  // Distribution of reorder_point values
  const rpDist: any[] = await prisma.$queryRaw`
    SELECT reorder_point, COUNT(*)::int as n
    FROM inventory
    WHERE reorder_point > 0
    GROUP BY reorder_point
    ORDER BY reorder_point
  `
  console.log(`\n  reorder_point distribution:`)
  for (const r of rpDist) console.log(`    ${r.reorder_point} → ${r.n} rows`)

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
