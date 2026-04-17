import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  // Search for MAL-046-GRÜ-S and rtrtr Black XS variants
  const patterns = ['MAL-046-GR%-S', 'MAL-%RTR%-SCH-XS', 'MAL-RTRTR%-XS']
  const variants = await prisma.productVariant.findMany({
    where: {
      OR: [
        { sku: { contains: 'MAL-046' } },
      ],
    },
    select: {
      id: true, sku: true, size: true, color: true,
      product: { select: { id: true, slug: true, translations: { select: { language: true, name: true } } } },
      inventory: {
        select: {
          quantityOnHand: true, quantityReserved: true, locationId: true,
          warehouse: { select: { id: true, name: true, type: true } },
        },
      },
    },
    take: 30,
  })

  for (const v of variants) {
    const total = v.inventory.reduce((s, i) => s + (i.quantityOnHand - i.quantityReserved), 0)
    const name = v.product.translations.find(t => t.language === 'de')?.name ?? v.product.slug
    console.log(`\nVariant: ${v.sku} (${name})`)
    console.log(`  color=${v.color} size=${v.size} available-total=${total}`)
    for (const inv of v.inventory) {
      const avail = inv.quantityOnHand - inv.quantityReserved
      console.log(`    • ${inv.warehouse.name} [${inv.warehouse.type}]: onHand=${inv.quantityOnHand} reserved=${inv.quantityReserved} available=${avail}`)
    }
  }

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
