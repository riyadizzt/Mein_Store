import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const v = await prisma.productVariant.findFirst({
    where: { sku: 'MAL-000065-GRA-S' },
    include: {
      product: { select: { id: true, deletedAt: true, translations: { select: { language: true, name: true } } } },
      inventory: { include: { warehouse: { select: { name: true } } } },
    },
  })
  if (!v) { console.log('❌ Variante MAL-000065-GRA-S existiert NICHT in der DB'); await prisma.$disconnect(); return }
  const name = v.product.translations.find((t: any) => t.language === 'de')?.name ?? '?'
  console.log('SKU:       ', v.sku)
  console.log('Produkt:   ', name, `(${v.product.id.slice(0, 8)})`)
  console.log('deletedAt: ', v.product.deletedAt?.toISOString() ?? 'null (aktiv)')
  console.log('isActive:  ', v.isActive)
  console.log('Inventory: ', v.inventory.length, 'rows')
  for (const i of v.inventory) {
    console.log(`  ${i.warehouse.name}  onHand=${i.quantityOnHand}  reserved=${i.quantityReserved}`)
  }
  if (v.inventory.length === 0) console.log('  ⚠  KEINE Inventory-Row — deshalb nicht im Bestand sichtbar!')
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
