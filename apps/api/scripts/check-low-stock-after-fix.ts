import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  // Exact same query as the new dashboard backend
  const rows: any[] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS n
    FROM inventory i
    JOIN product_variants pv ON pv.id = i.variant_id
    JOIN products p ON p.id = pv.product_id
    WHERE (i.quantity_on_hand - i.quantity_reserved) <= i.reorder_point
      AND i.reorder_point > 0
      AND p.deleted_at IS NULL
      AND p.is_active = true
      AND pv.is_active = true
  `
  const count = Number(rows[0]?.n ?? 0)
  console.log(`\n  Low-stock count (after filter fix): ${count}`)
  
  if (count > 0) {
    // Show what's still flagged
    const detail: any[] = await prisma.$queryRaw`
      SELECT pv.sku, i.quantity_on_hand, i.quantity_reserved, i.reorder_point, w.name as wh
      FROM inventory i
      JOIN product_variants pv ON pv.id = i.variant_id
      JOIN products p ON p.id = pv.product_id
      JOIN warehouses w ON w.id = i.warehouse_id
      WHERE (i.quantity_on_hand - i.quantity_reserved) <= i.reorder_point
        AND i.reorder_point > 0
        AND p.deleted_at IS NULL
        AND p.is_active = true
        AND pv.is_active = true
      ORDER BY (i.quantity_on_hand - i.quantity_reserved) ASC
      LIMIT 10
    `
    console.log(`\n  Details (top 10):`)
    for (const r of detail) {
      console.log(`    ${r.sku.padEnd(22)}  onHand=${r.quantity_on_hand}  reserved=${r.quantity_reserved}  reorder=${r.reorder_point}  ${r.wh}`)
    }
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
