import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const id = 'baf3fc56-b568-4f24-8a83-aa04a856b063'
  const wh = await prisma.warehouse.findUnique({ where: { id } })
  console.log(`\n  Warehouse: ${JSON.stringify(wh, null, 2)}\n`)

  // Count FK dependencies
  const invCount = await prisma.inventory.count({ where: { warehouseId: id } })
  const orderCount = await prisma.order.count({ where: { fulfillmentWarehouseId: id } })
  const stockRes = await prisma.stockReservation.count({ where: { warehouseId: id } })
  const movements = await prisma.inventoryMovement.count({ where: { warehouseId: id } })

  // Check locations table
  try {
    const locs = await (prisma as any).inventoryLocation?.count?.({ where: { warehouseId: id } }) ?? 0
    console.log(`  inventoryLocations:  ${locs}`)
  } catch {}

  console.log(`  inventory rows:      ${invCount}`)
  console.log(`  orders (fulfillment):${orderCount}`)
  console.log(`  stockReservations:   ${stockRes}`)
  console.log(`  inventoryMovements:  ${movements}`)

  // Also list all warehouses
  console.log(`\n  All warehouses:`)
  const all = await prisma.warehouse.findMany({ orderBy: { createdAt: 'asc' } })
  for (const w of all) {
    const inv = await prisma.inventory.count({ where: { warehouseId: w.id } })
    console.log(`    ${w.name.padEnd(22)}  id=${w.id.slice(0, 8)}  default=${w.isDefault}  inventory_rows=${inv}`)
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
