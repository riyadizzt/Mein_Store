import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const slugs = ['u8ol', 'ftjh', 'rdgfv']
  const prods = await prisma.product.findMany({
    where: { OR: [{ slug: { in: slugs } }, { translations: { some: { name: { contains: 'فستان أطفال صيفي' } } } }] },
    include: {
      variants: {
        include: {
          inventory: { include: { warehouse: { select: { name: true, isDefault: true } } } },
        },
      },
    },
  })
  for (const p of prods) {
    console.log(`\n  ${p.slug}  (isActive=${p.isActive} deletedAt=${p.deletedAt ? 'SET' : 'null'})`)
    for (const v of p.variants) {
      const invs = v.inventory
      const total = invs.reduce((s, i) => s + i.quantityOnHand, 0)
      const hasDefault = invs.some((i) => i.warehouse.isDefault)
      console.log(`    ${v.sku.padEnd(26)}  variantActive=${v.isActive}  inventory-rows=${invs.length}  total-onHand=${total}  defaultWH?=${hasDefault}`)
    }
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
