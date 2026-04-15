/**
 * Read-only: find any ProductVariants that collide with the SKUs the
 * new-product wizard is trying to create.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const patterns = ['MAL-HERREN-ROT', 'HERREN-ROT']
  for (const p of patterns) {
    const rows = await prisma.productVariant.findMany({
      where: { sku: { startsWith: p } },
      select: {
        id: true, sku: true, color: true, size: true, isActive: true, createdAt: true,
        product: {
          select: {
            id: true, slug: true, deletedAt: true,
            translations: { where: { language: 'de' }, select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
    console.log(`\n── SKUs starting with "${p}" → ${rows.length} match(es) ──\n`)
    for (const r of rows) {
      const prodName = r.product.translations[0]?.name ?? '(no DE name)'
      const status = r.product.deletedAt
        ? `SOFT-DELETED (${r.product.deletedAt.toISOString().slice(0, 10)})`
        : r.isActive ? 'active' : 'inactive'
      console.log(`  ${r.sku.padEnd(25)}  color=${(r.color ?? '—').padEnd(8)} size=${(r.size ?? '—').padEnd(4)}  ${status.padEnd(25)}  "${prodName}"`)
      console.log(`    variantId=${r.id}  productId=${r.product.id}  slug=${r.product.slug}`)
    }
  }
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
