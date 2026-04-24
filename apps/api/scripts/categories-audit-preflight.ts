/**
 * Categories Management — Pre-Flight Integrity Audit (read-only).
 *
 * Runs against live Supabase. No writes, no deletes, no side effects.
 * Output drives the pre-launch Categories Overhaul plan.
 *
 * Checks:
 *   1. Total counts (active + archived categories, products)
 *   2. Zombie products pointing to archived categories
 *   3. Orphan Coupons (appliesToCategoryId → archived category)
 *   4. Orphan Promotions (categoryId → archived category)
 *   5. Orphan SizeCharts (categoryId → archived category)
 *   6. Hierarchy integrity (children pointing to non-existent or archived parents)
 *   7. Categories with NO products at all (potential dead weight)
 *   8. Categories with MISSING google/ebay IDs (C6/C11 gaps)
 *   9. Duplicate slugs (shouldn't happen due to @unique, but verify)
 *  10. Products per category — spot-check top 10 by count
 */

import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()

type Row = Record<string, unknown>

async function main() {
  const sep = () => console.log('─'.repeat(72))

  sep()
  console.log('CATEGORIES MANAGEMENT — PRE-FLIGHT AUDIT')
  console.log('Date:', new Date().toISOString())
  sep()

  // ─── 1. Total counts ─────────────────────────────────────────
  const totals = await p.$queryRawUnsafe<Row[]>(`
    SELECT
      (SELECT COUNT(*)::int FROM categories)                            AS cat_total,
      (SELECT COUNT(*)::int FROM categories WHERE is_active = true)     AS cat_active,
      (SELECT COUNT(*)::int FROM categories WHERE is_active = false)    AS cat_archived,
      (SELECT COUNT(*)::int FROM products)                              AS prod_total,
      (SELECT COUNT(*)::int FROM products WHERE deleted_at IS NULL)     AS prod_live
  `)
  console.log('\n[1] Totals')
  console.log('   Categories: total=%d, active=%d, archived=%d',
    totals[0].cat_total, totals[0].cat_active, totals[0].cat_archived)
  console.log('   Products:   total=%d, live=%d', totals[0].prod_total, totals[0].prod_live)

  // ─── 2. Zombie products → archived categories ───────────────
  const zombieProducts = await p.$queryRawUnsafe<Row[]>(`
    SELECT p.id, p.slug, p.category_id, c.slug AS cat_slug, c.is_active
    FROM products p
    JOIN categories c ON c.id = p.category_id
    WHERE c.is_active = false
      AND p.deleted_at IS NULL
    ORDER BY p.slug
  `)
  console.log('\n[2] ZOMBIE PRODUCTS (live product → archived category): %d', zombieProducts.length)
  if (zombieProducts.length > 0) {
    for (const z of zombieProducts.slice(0, 10)) {
      console.log('   - product slug="%s" → archived cat="%s"', z.slug, z.cat_slug)
    }
    if (zombieProducts.length > 10) console.log('   ... +%d more', zombieProducts.length - 10)
  }

  // ─── 3. Orphan Coupons ──────────────────────────────────────
  const orphanCoupons = await p.$queryRawUnsafe<Row[]>(`
    SELECT cp.id, cp.code, cp.applies_to_category_id, c.slug AS cat_slug, c.is_active
    FROM coupons cp
    JOIN categories c ON c.id = cp.applies_to_category_id
    WHERE c.is_active = false
    ORDER BY cp.code
  `)
  console.log('\n[3] ORPHAN COUPONS (coupon → archived category): %d', orphanCoupons.length)
  for (const o of orphanCoupons.slice(0, 10)) {
    console.log('   - coupon code="%s" → archived cat="%s"', o.code, o.cat_slug)
  }

  // ─── 4. Orphan Promotions ───────────────────────────────────
  // Promotion.categoryId may be nullable — adapt if needed
  const promoColExists = await p.$queryRawUnsafe<Row[]>(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='promotions' AND column_name='category_id'
  `)
  if (promoColExists.length > 0) {
    const orphanPromos = await p.$queryRawUnsafe<Row[]>(`
      SELECT pr.id, pr.name, pr.category_id, c.slug AS cat_slug, c.is_active
      FROM promotions pr
      JOIN categories c ON c.id = pr.category_id
      WHERE c.is_active = false
      ORDER BY pr.name
    `)
    console.log('\n[4] ORPHAN PROMOTIONS (promotion → archived category): %d', orphanPromos.length)
    for (const o of orphanPromos.slice(0, 10)) {
      console.log('   - promo name="%s" → archived cat="%s"', o.name, o.cat_slug)
    }
  } else {
    console.log('\n[4] ORPHAN PROMOTIONS: skipped (no category_id column on promotions table)')
  }

  // ─── 5. Orphan SizeCharts ───────────────────────────────────
  // SizeChart uses is_active flag (no soft-delete column). The SizeChart
  // hardening commit 2026-04-21 added deletedAt to size_chart_entries but
  // NOT to size_charts — still a single-flag table.
  const chartDeletedCol = await p.$queryRawUnsafe<Row[]>(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='size_charts' AND column_name='deleted_at'
  `)
  const hasDeletedAt = chartDeletedCol.length > 0
  const orphanCharts = await p.$queryRawUnsafe<Row[]>(`
    SELECT sc.id, sc.name, sc.category_id, c.slug AS cat_slug, c.is_active
    FROM size_charts sc
    LEFT JOIN categories c ON c.id = sc.category_id
    WHERE sc.category_id IS NOT NULL
      ${hasDeletedAt ? 'AND sc.deleted_at IS NULL' : ''}
      AND (c.id IS NULL OR c.is_active = false)
    ORDER BY sc.name
  `)
  console.log('\n[5] ORPHAN SIZE-CHARTS (chart → missing/archived category): %d', orphanCharts.length)
  for (const o of orphanCharts.slice(0, 10)) {
    console.log('   - chart name="%s" → cat="%s" active=%s', o.name, o.cat_slug ?? '(missing)', o.is_active ?? 'n/a')
  }

  // ─── 6. Hierarchy integrity ─────────────────────────────────
  const brokenParent = await p.$queryRawUnsafe<Row[]>(`
    SELECT c.id, c.slug, c.parent_id, parent.slug AS parent_slug, parent.is_active AS parent_active
    FROM categories c
    LEFT JOIN categories parent ON parent.id = c.parent_id
    WHERE c.parent_id IS NOT NULL
      AND (parent.id IS NULL OR parent.is_active = false)
    ORDER BY c.slug
  `)
  console.log('\n[6] HIERARCHY ISSUES (child with missing/archived parent): %d', brokenParent.length)
  for (const b of brokenParent.slice(0, 10)) {
    console.log('   - child="%s" → parent="%s" active=%s', b.slug, b.parent_slug ?? '(missing)', b.parent_active ?? 'n/a')
  }

  // ─── 7. Empty active categories (no products) ──────────────
  const emptyCats = await p.$queryRawUnsafe<Row[]>(`
    SELECT c.id, c.slug, c.parent_id,
           (SELECT COUNT(*)::int FROM categories ch WHERE ch.parent_id = c.id AND ch.is_active = true) AS child_count
    FROM categories c
    WHERE c.is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM products p WHERE p.category_id = c.id AND p.deleted_at IS NULL
      )
    ORDER BY c.slug
  `)
  // Split: leaf-empty vs branch (branches with children are expected to be empty)
  const leafEmpty = emptyCats.filter((e) => Number(e.child_count) === 0)
  const branchEmpty = emptyCats.filter((e) => Number(e.child_count) > 0)
  console.log('\n[7] ACTIVE categories with no products')
  console.log('   Leaf (no children either): %d', leafEmpty.length)
  console.log('   Branch (has children — expected):  %d', branchEmpty.length)
  for (const e of leafEmpty.slice(0, 10)) {
    console.log('   - leaf-empty cat="%s"', e.slug)
  }

  // ─── 8. Missing googleCategoryId / ebayCategoryId ──────────
  const cat_missing_ids = await p.$queryRawUnsafe<Row[]>(`
    SELECT
      COUNT(*)                                                                AS total_active,
      COUNT(*) FILTER (WHERE google_category_id IS NULL OR google_category_id = '') AS missing_google,
      COUNT(*) FILTER (WHERE ebay_category_id IS NULL OR ebay_category_id = '')     AS missing_ebay
    FROM categories
    WHERE is_active = true
  `)
  const r = cat_missing_ids[0]
  console.log('\n[8] TAXONOMY-ID COVERAGE (active categories)')
  console.log('   total_active=%s, missing_google=%s, missing_ebay=%s',
    r.total_active, r.missing_google, r.missing_ebay)

  // ─── 9. Duplicate slugs ────────────────────────────────────
  const dupSlugs = await p.$queryRawUnsafe<Row[]>(`
    SELECT slug, COUNT(*)::int AS n
    FROM categories
    GROUP BY slug
    HAVING COUNT(*) > 1
  `)
  console.log('\n[9] DUPLICATE SLUGS: %d', dupSlugs.length)
  for (const d of dupSlugs) {
    console.log('   - slug="%s" count=%d', d.slug, d.n)
  }

  // ─── 10. Products per category — top 10 ───────────────────
  const topCats = await p.$queryRawUnsafe<Row[]>(`
    SELECT c.slug, c.is_active, COUNT(p.id)::int AS product_count
    FROM categories c
    LEFT JOIN products p ON p.category_id = c.id AND p.deleted_at IS NULL
    GROUP BY c.id, c.slug, c.is_active
    ORDER BY product_count DESC
    LIMIT 10
  `)
  console.log('\n[10] TOP CATEGORIES BY PRODUCT COUNT')
  for (const t of topCats) {
    console.log('   %3d products  [active=%s]  cat="%s"', t.product_count, t.is_active, t.slug)
  }

  sep()
  console.log('DONE.')
  sep()

  await p.$disconnect()
}

main().catch(async (e) => {
  console.error('audit failed:', e)
  await p.$disconnect()
  process.exit(1)
})
