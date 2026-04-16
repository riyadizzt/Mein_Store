import { PrismaClient } from '@prisma/client'
import { AdminInventoryService } from '../src/modules/admin/services/admin-inventory.service'

const prisma = new PrismaClient()
const service = new AdminInventoryService(prisma as any, { log: async () => {} } as any)

async function main() {
  console.log('\n── Test: search "MAL-000065-GRA-S" in grouped view ──\n')
  const result = await service.findAllGrouped({ search: 'MAL-000065-GRA-S' })
  console.log('Results:', result.data.length)
  for (const p of result.data) {
    console.log(`  ${p.productId.slice(0,8)}  variants:${p.variantsCount}  stock:${p.totalStock}`)
  }

  console.log('\n── Test: search "MAL-000065" (shorter) ──\n')
  const result2 = await service.findAllGrouped({ search: 'MAL-000065' })
  console.log('Results:', result2.data.length)
  for (const p of result2.data) {
    console.log(`  ${p.productId.slice(0,8)}  variants:${p.variantsCount}  stock:${p.totalStock}`)
  }

  console.log('\n── Test: search "Herren Sets" (product name) ──\n')
  const result3 = await service.findAllGrouped({ search: 'Herren Sets' })
  console.log('Results:', result3.data.length)
  for (const p of result3.data) {
    console.log(`  ${p.productId.slice(0,8)}  variants:${p.variantsCount}  stock:${p.totalStock}`)
  }

  console.log('\n── Raw DB: products with this variant ──\n')
  const raw = await prisma.product.findMany({
    where: { variants: { some: { sku: { contains: 'MAL-000065', mode: 'insensitive' } } } },
    select: { id: true, deletedAt: true, slug: true, basePrice: true, salePrice: true, translations: { select: { language: true, name: true } } },
  })
  for (const p of raw) {
    console.log(`  ${p.id.slice(0,8)}  deleted=${!!p.deletedAt}  slug=${p.slug}  base=${p.basePrice}  sale=${p.salePrice}`)
    for (const t of p.translations) console.log(`    ${t.language}: ${t.name}`)
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
