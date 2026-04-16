import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const rows = await prisma.inventory.findMany({
    where: { variant: { sku: 'MAL-000046-DUN-L' } },
    include: { location: true, warehouse: { select: { name: true } } },
  })
  for (const r of rows) {
    console.log(`warehouse=${r.warehouse.name}  locationId=${r.locationId ?? 'NULL'}  location=${r.location?.name ?? 'NULL'}  onHand=${r.quantityOnHand}`)
  }
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
