import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const defaultWh = await prisma.warehouse.findFirst({ where: { isDefault: true } })
  if (!defaultWh) throw new Error('no default warehouse')

  // Count affected rows BEFORE
  const affected = await prisma.inventory.count({
    where: { warehouseId: { not: defaultWh.id }, reorderPoint: { gt: 0 } },
  })
  console.log(`\n  Non-default-WH rows with reorder_point > 0: ${affected}`)
  console.log(`  → Setting all to reorder_point=0 (warehouses dormant after reset)\n`)

  const result = await prisma.inventory.updateMany({
    where: { warehouseId: { not: defaultWh.id } },
    data: { reorderPoint: 0 },
  })
  console.log(`  ✓ Updated ${result.count} rows`)

  // Re-check low-stock
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
  console.log(`\n  Post-fix low-stock count: ${Number(rows[0]?.n ?? 0)}\n`)
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
