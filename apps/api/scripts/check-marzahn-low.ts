import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const rows: any[] = await prisma.$queryRaw`
    SELECT pv.sku, pv.is_active AS variant_active, p.is_active AS product_active, p.deleted_at,
           i.quantity_on_hand, i.quantity_reserved, i.reorder_point
    FROM inventory i
    JOIN product_variants pv ON pv.id = i.variant_id
    JOIN products p ON p.id = pv.product_id
    JOIN warehouses w ON w.id = i.warehouse_id
    WHERE w.is_default = true
      AND (i.quantity_on_hand - i.quantity_reserved) <= i.reorder_point
  `
  console.log(`\n  ${rows.length} low-stock rows in DEFAULT warehouse:\n`)
  for (const r of rows) {
    console.log(`    ${r.sku.padEnd(22)}  onHand=${r.quantity_on_hand}  p.active=${r.product_active}  v.active=${r.variant_active}  deleted=${r.deleted_at ? 'yes' : 'no'}`)
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
