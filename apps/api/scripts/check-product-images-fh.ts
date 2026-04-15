import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  // Find products named "fh" or "Fh" (user's test product from the screenshot)
  const products = await prisma.product.findMany({
    where: {
      translations: { some: { name: { contains: 'fh', mode: 'insensitive' } } },
    },
    include: {
      translations: true,
      images: { orderBy: { sortOrder: 'asc' } },
      variants: { select: { id: true, sku: true, color: true, size: true } },
    },
    take: 5,
  })

  console.log(`\nFound ${products.length} product(s) matching "fh"\n`)
  for (const p of products) {
    const name = p.translations.find((t) => t.language === 'ar')?.name
      ?? p.translations.find((t) => t.language === 'de')?.name
      ?? '?'
    console.log(`── ${name} (${p.id.slice(0, 8)}) ──`)
    console.log(`  Translations: ${p.translations.map((t) => `${t.language}:"${t.name}"`).join(', ')}`)
    console.log(`  Variants (${p.variants.length}): ${p.variants.map((v) => `${v.color}/${v.size}`).join(', ')}`)
    console.log(`  Images (${p.images.length}):`)
    for (const img of p.images) {
      console.log(`    sortOrder=${img.sortOrder}  isPrimary=${img.isPrimary}  url=${img.url}`)
    }
    if (p.images.length === 0) {
      console.log('    (no images)')
    }
    console.log()
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
