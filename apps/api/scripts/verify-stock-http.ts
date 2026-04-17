/**
 * Hit the public storefront product endpoint and verify the new max-per-warehouse
 * stock semantic is actually served. Uses slug discovery to avoid hardcoding.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const API = process.env.API_URL ?? 'http://localhost:3001/api/v1'

const TARGET_SKUS = [
  { sku: 'MAL-046-GRÜ-S', expected: 2, note: '2+0+1 split → max=2' },
  { sku: 'MAL-046-BEI-M', expected: 36, note: '36+12+1 split → max=36' },
  { sku: 'MAL-RTRTR-SCH-XS', expected: 43, note: 'single warehouse, unchanged' },
]

async function main() {
  // Resolve slugs
  const variants = await prisma.productVariant.findMany({
    where: { sku: { in: TARGET_SKUS.map((t) => t.sku) } },
    select: { sku: true, product: { select: { slug: true } } },
  })
  const slugBySku = new Map(variants.map((v) => [v.sku, v.product.slug]))

  const uniqSlugs = [...new Set(variants.map((v) => v.product.slug))]
  console.log(`\n═══ Live HTTP Verification ═══`)
  console.log(`  API: ${API}`)
  console.log(`  Slugs to hit: ${uniqSlugs.join(', ')}\n`)

  let pass = 0
  let fail = 0

  for (const { sku, expected, note } of TARGET_SKUS) {
    const slug = slugBySku.get(sku)
    if (!slug) {
      console.log(`  ✗ ${sku}: slug not resolved`)
      fail++
      continue
    }
    const res = await fetch(`${API}/products/${slug}`)
    if (!res.ok) {
      console.log(`  ✗ ${sku}: HTTP ${res.status} — ${await res.text()}`)
      fail++
      continue
    }
    const body = (await res.json()) as any
    const variant = body.variants?.find((v: any) => v.sku === sku)
    if (!variant) {
      console.log(`  ✗ ${sku}: variant missing in response`)
      fail++
      continue
    }
    const actual = variant.stock
    const ok = actual === expected
    const marker = ok ? '✓' : '✗'
    console.log(`  ${marker} ${sku}: stock=${actual} (expected ${expected}) — ${note}`)
    if (ok) pass++
    else fail++
  }

  console.log(`\n  Result: ${pass} pass / ${fail} fail\n`)
  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
