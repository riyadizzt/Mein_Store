import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const v = await prisma.productVariant.findFirst({ where: { sku: 'MAL-000110-DGR-M' }, select: { id: true } })
  console.log('variantId:', v?.id)
  const bi = await prisma.boxItem.findMany({ where: { variantId: v?.id ?? '' } })
  console.log('boxItems:', bi.length)
  for (const b of bi) console.log('  boxId=' + b.boxId + ' qty=' + b.quantity + ' variantId=' + b.variantId)

  // Check if the variant is in the grouped response
  const allBoxItems = await prisma.boxItem.count()
  console.log('\nTotal BoxItems in DB:', allBoxItems)

  // Check if variantId in boxItem matches exactly
  if (v) {
    const exactMatch = await prisma.boxItem.findMany({ where: { variantId: v.id } })
    console.log('Exact variantId match:', exactMatch.length)
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
