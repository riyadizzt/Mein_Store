import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const manifests = await prisma.boxManifest.count()
  const items = await prisma.boxItem.count()
  console.log(`\n  box_manifests: ${manifests}`)
  console.log(`  box_items:     ${items}`)

  const allItems = await prisma.boxItem.findMany({ take: 20 })
  const allManifests = await prisma.boxManifest.findMany()
  const manByID = new Map(allManifests.map((m: any) => [m.id, m]))
  console.log(`\n  Box items and inventory sync status:\n`)
  for (const bi of allItems) {
    const m = manByID.get(bi.boxId)
    const inv = await prisma.inventory.findFirst({
      where: { variantId: bi.variantId, warehouseId: m?.warehouseId ?? '' },
      include: { warehouse: { select: { name: true } } },
    })
    const sku = (await prisma.productVariant.findUnique({ where: { id: bi.variantId }, select: { sku: true } }))?.sku
    const invStr = inv ? `onHand=${inv.quantityOnHand} (${inv.warehouse?.name})` : 'NO inventory row'
    const drift = inv && inv.quantityOnHand < bi.quantity ? ' ⚠ DRIFT' : ''
    console.log(`  ${m?.boxNumber?.padEnd(18)}  sku=${(sku ?? '?').padEnd(22)}  boxQty=${bi.quantity}  ${invStr}${drift}`)
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
