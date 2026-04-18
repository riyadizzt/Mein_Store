import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  // The names u8ol, ftjh, rdgfv could be product names (NOT slugs)
  const names = ['u8ol', 'ftjh', 'rdgfv', 'فستان أطفال صيفي']
  for (const n of names) {
    const hits = await prisma.product.findMany({
      where: {
        OR: [
          { slug: { contains: n, mode: 'insensitive' } },
          { translations: { some: { name: { contains: n, mode: 'insensitive' } } } },
        ],
      },
      include: {
        variants: { include: { inventory: { include: { warehouse: { select: { name: true } } } } } },
        translations: { select: { language: true, name: true } },
      },
    })
    for (const p of hits) {
      console.log(`\n  slug=${p.slug} isActive=${p.isActive} deletedAt=${p.deletedAt ? 'YES' : 'null'}`)
      console.log(`    translations: ${p.translations.map(t => `${t.language}=${t.name}`).join(' | ')}`)
      for (const v of p.variants) {
        console.log(`    ${v.sku.padEnd(30)}  active=${v.isActive}  rows:`)
        for (const i of v.inventory) {
          console.log(`       ${i.warehouse.name.padEnd(22)} onHand=${i.quantityOnHand} reserved=${i.quantityReserved} reorder=${i.reorderPoint}`)
        }
      }
    }
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
