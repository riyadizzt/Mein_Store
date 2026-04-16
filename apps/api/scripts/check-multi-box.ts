import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const variant = await prisma.productVariant.findFirst({
    where: { sku: 'MAL-000110-DGR-M' },
    select: { id: true, sku: true },
  })
  if (!variant) { console.log('Variante nicht gefunden'); await prisma.$disconnect(); return }

  // Inventory rows
  const invRows = await prisma.inventory.findMany({
    where: { variantId: variant.id },
    include: { warehouse: { select: { name: true } }, location: { select: { name: true } } },
  })
  console.log(`\n── Inventory für ${variant.sku} ──`)
  for (const r of invRows) {
    console.log(`  ${r.warehouse.name.padEnd(20)} onHand=${r.quantityOnHand}  location=${r.location?.name ?? 'NULL'}`)
  }

  // In which boxes?
  const boxItems = await prisma.boxItem.findMany({ where: { variantId: variant.id } })
  console.log(`\n── Box-Items ──`)
  for (const bi of boxItems) {
    const manifest = await prisma.boxManifest.findUnique({ where: { id: bi.boxId }, select: { boxNumber: true, status: true, warehouseId: true } })
    const wh = manifest ? await prisma.warehouse.findUnique({ where: { id: manifest.warehouseId }, select: { name: true } }) : null
    console.log(`  ${manifest?.boxNumber ?? '?'} (${manifest?.status}) in ${wh?.name ?? '?'}  qty=${bi.quantity}`)
  }

  // The problem: inventory has ONE locationId per (variant, warehouse)
  // If variant is in 2 boxes in the same warehouse, only the LAST scanned box wins
  console.log(`\n── Problem-Analyse ──`)
  console.log(`  Inventory hat ${invRows.length} Row(s)`)
  console.log(`  BoxItems hat ${boxItems.length} Einträge`)
  if (boxItems.length > 1) {
    console.log(`  ⚠  Variante in ${boxItems.length} Boxen — locationId zeigt nur auf EINE davon`)
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
