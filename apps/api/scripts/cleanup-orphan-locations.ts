import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  console.log('\n═══ InventoryLocations Audit ═══\n')

  // All locations that LOOK like boxes (BOX-* naming)
  const boxLike = await prisma.inventoryLocation.findMany({
    where: { name: { startsWith: 'BOX-' } },
    include: { warehouse: { select: { name: true } } },
  })
  console.log(`  BOX-* locations: ${boxLike.length}`)
  for (const l of boxLike) {
    const invLinked = await prisma.inventory.count({ where: { locationId: l.id } })
    console.log(`    ${l.name.padEnd(22)}  id=${l.id.slice(0,8)}  warehouse=${l.warehouse?.name}  invRowsLinked=${invLinked}`)
  }

  // All locations total
  const all = await prisma.inventoryLocation.count()
  console.log(`\n  Total InventoryLocations: ${all}`)

  // Any other locations with box-manifest pattern?
  const nonBox = await prisma.inventoryLocation.findMany({
    where: { name: { not: { startsWith: 'BOX-' } } },
    take: 5,
  })
  console.log(`  Non-BOX locations (sample): ${nonBox.length}`)
  for (const l of nonBox) console.log(`    "${l.name}"`)

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
