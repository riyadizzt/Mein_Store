import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  // Mimic findAllGrouped WITHOUT a warehouse filter
  const products = await prisma.product.findMany({
    where: {
      deletedAt: null,
      OR: [
        { slug: { contains: 'u8ol' } },
        { slug: { contains: 'ftjh' } },
        { slug: { contains: 'rdgfv' } },
      ],
    },
    include: {
      variants: {
        where: { isActive: true },
        select: {
          sku: true,
          inventory: {
            select: { warehouseId: true, quantityOnHand: true, quantityReserved: true, warehouse: { select: { name: true, isDefault: true } } },
          },
        },
      },
    },
  })

  console.log('\n  WITHOUT warehouse filter (all WHs included):')
  for (const p of products) {
    let totalStock = 0, totalRes = 0, outCount = 0
    for (const v of p.variants) {
      let vS = 0, vR = 0
      for (const i of v.inventory) { vS += i.quantityOnHand; vR += i.quantityReserved }
      const avail = vS - vR
      if (v.inventory.length > 0 && avail <= 0) outCount++
      totalStock += vS; totalRes += vR
    }
    console.log(`    ${p.slug.padEnd(22)}  totalStock=${totalStock}  totalAvail=${totalStock - totalRes}  outCount=${outCount}`)
  }

  // Same but filter to Hamburg
  const hamburg = await prisma.warehouse.findFirst({ where: { name: { contains: 'Hamburg' } } })
  if (!hamburg) return
  console.log(`\n  WITH warehouse filter = "${hamburg.name}":`)
  const products2 = await prisma.product.findMany({
    where: {
      deletedAt: null,
      OR: [{ slug: { contains: 'u8ol' } }, { slug: { contains: 'ftjh' } }, { slug: { contains: 'rdgfv' } }],
      variants: { some: { inventory: { some: { warehouseId: hamburg.id } } } },
    },
    include: {
      variants: {
        where: { isActive: true },
        select: {
          sku: true,
          inventory: {
            where: { warehouseId: hamburg.id },
            select: { quantityOnHand: true, quantityReserved: true },
          },
        },
      },
    },
  })
  for (const p of products2) {
    let totalStock = 0, outCount = 0
    for (const v of p.variants) {
      let vS = 0
      for (const i of v.inventory) vS += i.quantityOnHand
      if (v.inventory.length > 0 && vS <= 0) outCount++
      totalStock += vS
    }
    console.log(`    ${p.slug.padEnd(22)}  totalStock=${totalStock}  outCount=${outCount}`)
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
