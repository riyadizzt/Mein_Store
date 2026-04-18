import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const boxLocs = await prisma.inventoryLocation.findMany({ where: { name: { startsWith: 'BOX-' } }, select: { id: true, name: true } })
  console.log(`\n  Deleting ${boxLocs.length} orphan BOX-* locations:\n`)

  await prisma.$transaction([
    // Clear any inventory row's reference to these locations first (FK safety)
    prisma.inventory.updateMany({
      where: { locationId: { in: boxLocs.map((l) => l.id) } },
      data: { locationId: null },
    }),
    // Now safe to delete the locations themselves
    prisma.inventoryLocation.deleteMany({
      where: { id: { in: boxLocs.map((l) => l.id) } },
    }),
  ])

  for (const l of boxLocs) console.log(`    ✓ ${l.name}`)

  // Post check
  const remaining = await prisma.inventoryLocation.count({ where: { name: { startsWith: 'BOX-' } } })
  const stillLinked = await prisma.inventory.count({
    where: { locationId: { in: boxLocs.map((l) => l.id) } },
  })
  console.log(`\n  Post-clean:  BOX locations remaining=${remaining}  inventory still linked=${stillLinked}`)

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
