import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  // 1. Does the product show up in grouped view WITHOUT search?
  const allProducts = await prisma.product.count({ where: { deletedAt: null } })
  console.log(`Total active products: ${allProducts}`)

  // 2. Does the grouped query find this product with search?
  const withSearch = await prisma.product.findMany({
    where: {
      deletedAt: null,
      OR: [
        { slug: { contains: 'MAL-000065-GRA-S', mode: 'insensitive' } },
        { translations: { some: { name: { contains: 'MAL-000065-GRA-S', mode: 'insensitive' } } } },
        { variants: { some: { OR: [{ sku: { contains: 'MAL-000065-GRA-S', mode: 'insensitive' } }, { barcode: { contains: 'MAL-000065-GRA-S', mode: 'insensitive' } }] } } },
      ],
    },
    select: { id: true, slug: true },
  })
  console.log(`Products matching "MAL-000065-GRA-S": ${withSearch.length}`)
  for (const p of withSearch) console.log(`  ${p.id.slice(0, 8)} slug=${p.slug}`)

  // 3. Does the product have a category?
  const prod = await prisma.product.findFirst({
    where: { id: withSearch[0]?.id },
    select: { categoryId: true },
  })
  console.log(`CategoryId: ${prod?.categoryId ?? 'null'}`)

  // 4. Check if the user's current filter might hide it
  // The "جميع الأقسام" = no category filter = should show everything
  console.log('\n── Does it show up with default params (no filters, page 0, limit 50)? ──')
  const defaultQ = await prisma.product.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 50,
    skip: 0,
    select: { id: true },
  })
  const found = defaultQ.some((p) => p.id === withSearch[0]?.id)
  console.log(`In first 50 products (by date): ${found ? 'YES' : 'NO — might be on a later page'}`)

  // 5. Check total pages needed
  const rank = await prisma.product.count({
    where: { deletedAt: null, createdAt: { gt: (await prisma.product.findUnique({ where: { id: withSearch[0]?.id }, select: { createdAt: true } }))!.createdAt } },
  })
  console.log(`This product is #${rank + 1} by newest-first (page ${Math.floor(rank / 50) + 1} at 50/page)`)

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
