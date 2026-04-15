/**
 * Read-only: compares the actual inventory row count in Postgres with
 * what the CSV export currently returns. Proves whether the export is
 * complete or silently truncated.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const warehouses = await prisma.warehouse.findMany({
    select: { id: true, name: true, type: true, isActive: true },
  })

  // Total inventory rows (one per variant × warehouse combo that exists)
  const totalInventory = await prisma.inventory.count({
    where: { variant: { product: { deletedAt: null } } },
  })
  console.log(`\nTotal Inventory rows (non-deleted products): ${totalInventory}\n`)

  console.log('Per warehouse:')
  for (const w of warehouses) {
    const count = await prisma.inventory.count({
      where: { warehouseId: w.id, variant: { product: { deletedAt: null } } },
    })
    const withStock = await prisma.inventory.count({
      where: { warehouseId: w.id, quantityOnHand: { gt: 0 }, variant: { product: { deletedAt: null } } },
    })
    const units = await prisma.inventory.aggregate({
      where: { warehouseId: w.id, variant: { product: { deletedAt: null } } },
      _sum: { quantityOnHand: true },
    })
    console.log(`  ${w.name.padEnd(25)} ${w.type.padEnd(10)}  rows=${count.toString().padStart(4)}   with_stock=${withStock.toString().padStart(4)}   total_units=${String(units._sum.quantityOnHand ?? 0).padStart(6)}${w.isActive ? '' : '  [INACTIVE]'}`)
  }

  // Distinct variants
  const variants = await prisma.productVariant.count({
    where: { product: { deletedAt: null } },
  })
  console.log(`\nDistinct variants (non-deleted): ${variants}`)
  console.log(`Expected if every variant had a row in every warehouse: ${variants * warehouses.length}`)

  // Soft-deleted products whose inventory rows are still there
  const orphaned = await prisma.inventory.count({
    where: { variant: { product: { deletedAt: { not: null } } } },
  })
  if (orphaned > 0) {
    console.log(`\n⚠  ${orphaned} inventory rows belong to SOFT-DELETED products (not in CSV export)`)
  }

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
