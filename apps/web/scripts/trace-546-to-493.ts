import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  // Total variants on non-deleted products
  const all = await prisma.productVariant.count({ where: { product: { deletedAt: null } } })
  const active = await prisma.productVariant.count({ where: { isActive: true, product: { deletedAt: null } } })
  const inactive = await prisma.productVariant.count({ where: { isActive: false, product: { deletedAt: null } } })
  console.log(`\n  Non-deleted products:`)
  console.log(`    all variants:      ${all}`)
  console.log(`    active variants:   ${active}`)
  console.log(`    inactive variants: ${inactive}`)
  // Check: does Marzahn have rows for INACTIVE variants too?
  const marzahn = await prisma.warehouse.findFirst({ where: { isDefault: true } })
  const marzahnAllVariants = await prisma.inventory.count({ where: { warehouseId: marzahn!.id } })
  const marzahnActive = await prisma.inventory.count({
    where: { warehouseId: marzahn!.id, variant: { isActive: true, product: { deletedAt: null } } },
  })
  const marzahnInactive = await prisma.inventory.count({
    where: { warehouseId: marzahn!.id, OR: [{ variant: { isActive: false } }, { variant: { product: { deletedAt: { not: null } } } }] },
  })
  console.log(`\n  Marzahn inventory rows:`)
  console.log(`    total:     ${marzahnAllVariants}`)
  console.log(`    active-variant rows:   ${marzahnActive}`)
  console.log(`    inactive-variant rows: ${marzahnInactive}`)
  // "Other" is probably variants where product.deletedAt != null
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
