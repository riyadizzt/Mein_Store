import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const variant = await prisma.productVariant.findFirst({
    where: { sku: 'MAL-000046-DUN-L' },
    select: { id: true, sku: true, color: true, size: true },
  })
  if (!variant) { console.log('Variante nicht gefunden'); await prisma.$disconnect(); return }
  console.log(`Variante: ${variant.sku} (${variant.color}/${variant.size})`)

  const invRows = await prisma.inventory.findMany({
    where: { variantId: variant.id },
    include: { warehouse: { select: { name: true } }, location: { select: { name: true } } },
  })
  console.log(`\nInventory Rows: ${invRows.length}`)
  for (const inv of invRows) {
    console.log(`  ${inv.warehouse.name.padEnd(20)} onHand=${inv.quantityOnHand}  reserved=${inv.quantityReserved}  available=${inv.quantityOnHand - inv.quantityReserved}  location=${inv.location?.name ?? 'none'}`)
  }

  // BoxItem has no FK, uses variantId as string
  const boxItems = await prisma.boxItem.findMany({
    where: { variantId: variant.id },
  })
  console.log(`\nBox Items: ${boxItems.length}`)
  for (const bi of boxItems) {
    // Fetch manifest separately (no FK relation)
    const manifest = await prisma.boxManifest.findUnique({ where: { id: bi.boxId }, select: { boxNumber: true, status: true } })
    console.log(`  ${manifest?.boxNumber ?? bi.boxId.slice(0, 8)} (${manifest?.status ?? '?'})  qty=${bi.quantity}`)
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
