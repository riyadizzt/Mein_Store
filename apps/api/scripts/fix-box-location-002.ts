/**
 * Fix: Set inventory.locationId for all items in BOX-2026-W-002
 * so the BOX badge appears in the inventory grouped view.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const manifest = await prisma.boxManifest.findFirst({
    where: { boxNumber: 'BOX-2026-W-002' },
    select: { id: true, boxNumber: true, locationId: true, warehouseId: true },
  })
  if (!manifest) { console.log('Box not found'); await prisma.$disconnect(); return }
  console.log(`Box: ${manifest.boxNumber}  locationId=${manifest.locationId}  warehouseId=${manifest.warehouseId}`)

  const boxItems = await prisma.boxItem.findMany({
    where: { boxId: manifest.id },
    select: { variantId: true, quantity: true },
  })
  console.log(`Items in box: ${boxItems.length}`)

  for (const bi of boxItems) {
    const result = await prisma.inventory.updateMany({
      where: { variantId: bi.variantId, warehouseId: manifest.warehouseId },
      data: { locationId: manifest.locationId },
    })
    const variant = await prisma.productVariant.findUnique({ where: { id: bi.variantId }, select: { sku: true } })
    console.log(`  ${variant?.sku ?? bi.variantId.slice(0, 8)}  qty=${bi.quantity}  updated=${result.count} row(s)`)
  }

  console.log('\n✅ Done — BOX badge should now appear in inventory view')
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
