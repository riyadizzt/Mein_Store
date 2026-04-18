import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  // Total across ALL inventory rows
  const agg = await prisma.inventory.aggregate({ _sum: { quantityOnHand: true }, _count: true })
  console.log(`\n  Inventory rows (all): ${agg._count}   Total onHand: ${Number(agg._sum.quantityOnHand ?? 0)}`)

  // Only Marzahn (default)
  const marzahn = await prisma.warehouse.findFirst({ where: { isDefault: true } })
  const marzahnAgg = await prisma.inventory.aggregate({
    where: { warehouseId: marzahn!.id },
    _sum: { quantityOnHand: true }, _count: true,
  })
  console.log(`  Marzahn rows:         ${marzahnAgg._count}   Total onHand: ${Number(marzahnAgg._sum.quantityOnHand ?? 0)}`)

  // Distinct variants across all active inventories
  const variants = await prisma.productVariant.count({ where: { isActive: true, product: { deletedAt: null } } })
  console.log(`\n  Active variants (p.deleted=null, v.active=true, p.is_active any): ${variants}`)
  const variantsActiveP = await prisma.productVariant.count({
    where: { isActive: true, product: { deletedAt: null, isActive: true } },
  })
  console.log(`  Active variants (p.active=true too): ${variantsActiveP}`)

  // Product breakdown
  const prodActive = await prisma.product.count({ where: { isActive: true, deletedAt: null } })
  const prodInactive = await prisma.product.count({ where: { isActive: false, deletedAt: null } })
  console.log(`\n  Products: active=${prodActive}  inactive(not-deleted)=${prodInactive}`)

  // Inactive products variants — they still have 10 in Marzahn from the seed
  const inactiveSeeded = await prisma.inventory.aggregate({
    where: {
      warehouseId: marzahn!.id,
      quantityOnHand: { gt: 0 },
      variant: { isActive: true, product: { isActive: false } },
    },
    _sum: { quantityOnHand: true }, _count: true,
  })
  console.log(`  Seeded in Marzahn for INACTIVE products: ${inactiveSeeded._count} rows, ${Number(inactiveSeeded._sum.quantityOnHand ?? 0)} units`)

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
