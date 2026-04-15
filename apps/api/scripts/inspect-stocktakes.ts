/**
 * Read-only: lists every stocktake with its warehouse, status, item
 * count, correction pointer, and creator. Helps diagnose "the list on
 * my dashboard doesn't match what I expect" situations.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const rows = await prisma.stocktake.findMany({
    include: { _count: { select: { items: true } } },
    orderBy: { createdAt: 'desc' },
  })
  const warehouses = await prisma.warehouse.findMany({ select: { id: true, name: true, type: true, isActive: true } })
  const wMap = new Map(warehouses.map((w) => [w.id, w]))

  console.log(`\nTotal stocktakes in DB: ${rows.length}\n`)
  for (const r of rows) {
    const w = wMap.get(r.warehouseId)
    const whDesc = w ? `${w.name} (${w.type}${w.isActive ? '' : ', INACTIVE'})` : `UNKNOWN warehouseId=${r.warehouseId}`
    const note = r.notes ? ` | notes="${r.notes}"` : ''
    console.log(`#${r.id.slice(-6)}  ${r.status.padEnd(12)}  ${r._count.items.toString().padStart(3)} items  ${r.createdAt.toISOString().slice(0, 19)}  ${whDesc}${note}`)
  }

  console.log('\nAll warehouses:')
  for (const w of warehouses) {
    console.log(`  ${w.id.slice(0, 8)}… ${w.name.padEnd(25)} type=${w.type.padEnd(10)} active=${w.isActive}`)
  }

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
