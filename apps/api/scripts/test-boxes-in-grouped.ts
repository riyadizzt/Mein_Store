import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Simulate the batch query from findAllGrouped
  const targetSku = 'MAL-000046-DUN-L'
  const v = await prisma.productVariant.findFirst({ where: { sku: targetSku }, select: { id: true } })
  if (!v) { console.log('Not found'); return }
  console.log(`variantId for ${targetSku}: ${v.id}`)

  // Same query as in findAllGrouped
  const boxItems = await prisma.boxItem.findMany({
    where: { variantId: { in: [v.id] } },
    select: { variantId: true, boxId: true, quantity: true },
  })
  console.log(`BoxItems found: ${boxItems.length}`)
  for (const bi of boxItems) {
    const m = await prisma.boxManifest.findUnique({ where: { id: bi.boxId }, select: { boxNumber: true, status: true } })
    console.log(`  ${m?.boxNumber} (${m?.status})  qty=${bi.quantity}  variantId=${bi.variantId}`)
  }

  // Also check all box items in DB
  const allBi = await prisma.boxItem.findMany({ select: { variantId: true, boxId: true, quantity: true } })
  console.log(`\nTotal BoxItems: ${allBi.length}`)
  for (const bi of allBi) {
    const m = await prisma.boxManifest.findUnique({ where: { id: bi.boxId }, select: { boxNumber: true } })
    const vr = await prisma.productVariant.findUnique({ where: { id: bi.variantId }, select: { sku: true } })
    console.log(`  ${vr?.sku ?? '?'}  in ${m?.boxNumber ?? '?'}  qty=${bi.quantity}`)
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
