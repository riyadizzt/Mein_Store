import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const marzahn = await prisma.warehouse.findFirst({ where: { isDefault: true } })
  // Find inventory rows in Marzahn with onHand != 10
  const outliers = await prisma.inventory.findMany({
    where: { warehouseId: marzahn!.id, NOT: { quantityOnHand: 10 } },
    include: {
      variant: {
        select: { sku: true, isActive: true, product: { select: { slug: true, isActive: true, deletedAt: true } } },
      },
    },
  })
  console.log(`\n  Marzahn rows where onHand != 10: ${outliers.length}\n`)
  for (const o of outliers) {
    console.log(`    ${o.variant.sku.padEnd(28)}  onHand=${o.quantityOnHand}  reserved=${o.quantityReserved}  v.active=${o.variant.isActive}  p.active=${o.variant.product.isActive}  p.deleted=${o.variant.product.deletedAt ? 'yes' : 'no'}`)
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
