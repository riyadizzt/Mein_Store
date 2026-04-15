/**
 * READ-ONLY inspection script.
 *
 * Lists every soft-deleted product and checks whether it is safe to
 * hard-delete. A product is SAFE only if NONE of these reference it:
 *
 *   1. order_items.variant_id → any variant of the product
 *   2. product_reviews.product_id (no cascade on delete)
 *   3. coupons.applies_to_product_id (no cascade on delete)
 *   4. promotions.product_id (no cascade on delete)
 *   5. returns.return_items JSON column (soft ref by variantId — warn)
 *   6. abandoned_carts.items JSON column (soft ref by variantId — warn)
 *
 * Prints a full table with blocker reasons and dumps the safe IDs as a
 * TypeScript array at the end so the next (write) step can reuse it.
 *
 * Does NOT mutate anything. Run with:
 *   pnpm --filter @omnichannel/api exec tsx scripts/inspect-soft-deleted-products.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type Blocker = {
  orderItems: number
  reviews: number
  coupons: number
  promotions: number
  returnJson: number
  cartJson: number
}

type Row = {
  id: string
  slug: string
  nameDe: string | null
  deletedAt: Date | null
  variantCount: number
  blockers: Blocker
  safe: boolean
}

async function main() {
  const products = await prisma.product.findMany({
    where: { deletedAt: { not: null } },
    select: {
      id: true,
      slug: true,
      deletedAt: true,
      variants: { select: { id: true } },
      translations: { where: { language: 'de' }, select: { name: true } },
    },
    orderBy: { deletedAt: 'desc' },
  })

  if (products.length === 0) {
    console.log('No soft-deleted products found. Nothing to inspect.')
    return
  }

  const rows: Row[] = []

  for (const p of products) {
    const variantIds = p.variants.map((v) => v.id)

    const [orderItems, reviews, coupons, promotions] = await Promise.all([
      variantIds.length
        ? prisma.orderItem.count({ where: { variantId: { in: variantIds } } })
        : Promise.resolve(0),
      prisma.productReview.count({ where: { productId: p.id } }),
      prisma.coupon.count({ where: { appliesToProductId: p.id } }),
      prisma.promotion.count({ where: { productId: p.id } }),
    ])

    // JSON soft references — raw SQL, variantId inside a jsonb array of objects.
    let returnJson = 0
    let cartJson = 0
    if (variantIds.length) {
      const returnRes = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM returns
        WHERE return_items::jsonb @> ANY (
          ARRAY(SELECT jsonb_build_array(jsonb_build_object('variantId', v)) FROM unnest(${variantIds}::text[]) AS v)
        )
      `.catch(() => [{ count: BigInt(0) }])
      returnJson = Number(returnRes[0]?.count ?? 0)

      const cartRes = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM abandoned_carts
        WHERE items::jsonb @> ANY (
          ARRAY(SELECT jsonb_build_array(jsonb_build_object('variantId', v)) FROM unnest(${variantIds}::text[]) AS v)
        )
      `.catch(() => [{ count: BigInt(0) }])
      cartJson = Number(cartRes[0]?.count ?? 0)
    }

    const blockers: Blocker = {
      orderItems,
      reviews,
      coupons,
      promotions,
      returnJson,
      cartJson,
    }

    rows.push({
      id: p.id,
      slug: p.slug,
      nameDe: p.translations[0]?.name ?? null,
      deletedAt: p.deletedAt,
      variantCount: variantIds.length,
      blockers,
      // JSON soft references do NOT block — orders cover them. We warn only.
      safe:
        orderItems === 0 &&
        reviews === 0 &&
        coupons === 0 &&
        promotions === 0,
    })
  }

  const safe = rows.filter((r) => r.safe)
  const blocked = rows.filter((r) => !r.safe)
  const withSoftRefs = rows.filter(
    (r) => r.safe && (r.blockers.returnJson > 0 || r.blockers.cartJson > 0),
  )

  console.log('')
  console.log('════════════════════════════════════════════════════════════')
  console.log('  SOFT-DELETED PRODUCT INSPECTION — READ ONLY')
  console.log('════════════════════════════════════════════════════════════')
  console.log('')
  console.log(`Total soft-deleted:   ${rows.length}`)
  console.log(`  ✅ Safe to purge:   ${safe.length}`)
  console.log(`  ⛔ Blocked:         ${blocked.length}`)
  console.log(`  ⚠️  Soft-ref warn:  ${withSoftRefs.length}  (safe but JSON hit)`)
  console.log('')

  const printRow = (r: Row) => {
    const name = (r.nameDe ?? '(no DE name)').slice(0, 45).padEnd(45)
    const slug = r.slug.slice(0, 28).padEnd(28)
    const del = r.deletedAt ? r.deletedAt.toISOString().slice(0, 10) : '—'
    const bl = r.blockers
    const blockerStr = [
      bl.orderItems > 0 ? `order=${bl.orderItems}` : null,
      bl.reviews > 0 ? `rev=${bl.reviews}` : null,
      bl.coupons > 0 ? `coup=${bl.coupons}` : null,
      bl.promotions > 0 ? `promo=${bl.promotions}` : null,
      bl.returnJson > 0 ? `retJSON=${bl.returnJson}` : null,
      bl.cartJson > 0 ? `cartJSON=${bl.cartJson}` : null,
    ]
      .filter(Boolean)
      .join(' ')
    const icon = r.safe ? '✅' : '⛔'
    console.log(`${icon}  ${name}  ${slug}  ${del}  v=${r.variantCount}  ${blockerStr}`)
  }

  if (safe.length > 0) {
    console.log('── SAFE TO HARD-DELETE ─────────────────────────────────────')
    safe.forEach(printRow)
    console.log('')
  }

  if (blocked.length > 0) {
    console.log('── BLOCKED (keep soft-deleted) ─────────────────────────────')
    blocked.forEach(printRow)
    console.log('')
  }

  if (safe.length > 0) {
    console.log('── SAFE IDS (paste into delete script) ─────────────────────')
    console.log('const SAFE_IDS = [')
    for (const r of safe) {
      console.log(`  '${r.id}', // ${r.slug}`)
    }
    console.log(']')
    console.log('')
  }

  console.log('Legend:')
  console.log('  order    = order_items referencing a variant (BLOCKER)')
  console.log('  rev      = product_reviews on the product    (BLOCKER)')
  console.log('  coup     = coupons applied to the product    (BLOCKER)')
  console.log('  promo    = promotions on the product         (BLOCKER)')
  console.log('  retJSON  = return.returnItems JSON refs      (warn only)')
  console.log('  cartJSON = abandoned_cart.items JSON refs    (warn only)')
  console.log('')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
