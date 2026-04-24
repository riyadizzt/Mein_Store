/**
 * Categories — Phase 0 Cleanup (Dummy-Daten-Aufräumen VOR dem Overhaul).
 *
 * All four actions run in a single Prisma $transaction when --apply is set.
 * Default is DRY-RUN: no writes, only reports what WOULD happen.
 *
 * Actions:
 *   1. Hard-delete 15 Zombie-Products from archived "jacken" category
 *      (safe because: 0 OrderItems attached, all Product→child relations
 *       have onDelete:Cascade — variants, translations, images, inventory,
 *       channel-listings, stock-reservations all wipe automatically).
 *   2. Hard-delete the archived "jacken" category itself
 *      (CategoryTranslations have onDelete:Cascade — no manual cleanup needed).
 *   3. Merge "sets" category into "baby-sets-outfits"
 *      (both share the same parent Baby; sets has 1 product which gets
 *       moved, then sets is hard-deleted).
 *   4. Rename "Herren Schuhe" → "Herrenschuhe"
 *      (slug: herren-schuhe → herrenschuhe; DE translation updated;
 *       5 products stay linked by id, zero data move).
 *
 * Idempotent: re-runs detect already-done state and skip. Safe to rerun.
 *
 * Usage:
 *   npx tsx scripts/categories-cleanup-phase0.ts            # dry-run
 *   npx tsx scripts/categories-cleanup-phase0.ts --apply    # writes
 */

import { PrismaClient, Prisma } from '@prisma/client'

const p = new PrismaClient()
const APPLY = process.argv.includes('--apply')
const SEP = '─'.repeat(72)

type Step = {
  label: string
  plan: string[]
  execute: (tx: Prisma.TransactionClient) => Promise<string[]>
}

async function buildPlan(): Promise<Step[]> {
  const jacken = await p.category.findFirst({ where: { slug: 'jacken' } })
  const sets = await p.category.findFirst({ where: { slug: 'sets' } })
  const babySets = await p.category.findFirst({ where: { slug: 'baby-sets-outfits' } })
  const herrenSchuhe = await p.category.findFirst({ where: { slug: 'herren-schuhe' } })
  const herrenSchuheTarget = await p.category.findFirst({ where: { slug: 'herrenschuhe' } })

  const steps: Step[] = []

  // ─── 1 + 2. Zombie products + "jacken" ──────────────────────
  if (jacken) {
    const prods = await p.product.findMany({
      where: { categoryId: jacken.id },
      select: { id: true, slug: true },
    })
    const variants = await p.productVariant.findMany({
      where: { productId: { in: prods.map((x) => x.id) } },
      select: { id: true },
    })
    const invCount = await p.inventory.count({ where: { variantId: { in: variants.map((v) => v.id) } } })
    const transCount = await p.productTranslation.count({ where: { productId: { in: prods.map((x) => x.id) } } })
    const orderItemCount = await p.orderItem.count({ where: { variantId: { in: variants.map((v) => v.id) } } })

    if (orderItemCount > 0) {
      throw new Error(
        `ABORT: jacken-Products have ${orderItemCount} orderItems attached — GoBD-critical. Delete refused.`,
      )
    }

    const label = `Hard-delete ${prods.length} zombie products in archived "jacken"`
    const plan = [
      `  Products to delete: ${prods.length}`,
      `  Variants cascaded:  ${variants.length}`,
      `  Inventory rows cascaded: ${invCount}`,
      `  Translations cascaded: ${transCount}`,
      `  OrderItems blocking:   ${orderItemCount} (must be 0)`,
      ...prods.slice(0, 5).map((pr) => `    - slug="${pr.slug}"`),
      prods.length > 5 ? `    ... +${prods.length - 5} more` : '',
    ].filter(Boolean)
    steps.push({
      label,
      plan,
      execute: async (tx) => {
        const delProds = await tx.product.deleteMany({ where: { categoryId: jacken.id } })
        return [`products deleted: ${delProds.count}`]
      },
    })

    // Step 2: after products gone, category itself
    steps.push({
      label: `Hard-delete archived "jacken" category`,
      plan: [
        `  category id: ${jacken.id}`,
        `  isActive: ${jacken.isActive}`,
        `  CategoryTranslations: cascade via onDelete:Cascade`,
        `  Expected post-check: 0 products pointing here`,
      ],
      execute: async (tx) => {
        // Sanity-verify inside tx: no products remain
        const stillThere = await tx.product.count({ where: { categoryId: jacken.id } })
        if (stillThere > 0) throw new Error(`jacken still has ${stillThere} products — abort`)
        const del = await tx.category.delete({ where: { id: jacken.id } })
        return [`category deleted: slug=${del.slug}`]
      },
    })
  } else {
    steps.push({
      label: '[SKIP] "jacken" category not found — already cleaned or never existed',
      plan: [],
      execute: async () => ['skipped'],
    })
  }

  // ─── 3. Merge "sets" into "baby-sets-outfits" ──────────────
  if (sets && babySets) {
    const prods = await p.product.findMany({
      where: { categoryId: sets.id },
      select: { id: true, slug: true },
    })
    const childCats = await p.category.count({ where: { parentId: sets.id } })
    const coupons = await p.coupon.count({ where: { appliesToCategoryId: sets.id } })
    const promos = await p.promotion.count({ where: { categoryId: sets.id } })
    const charts = await p.sizeChart.count({ where: { categoryId: sets.id } })

    if (childCats > 0 || coupons > 0 || promos > 0 || charts > 0) {
      throw new Error(
        `ABORT: "sets" has dependencies besides products — children=${childCats} coupons=${coupons} promos=${promos} charts=${charts}`,
      )
    }

    steps.push({
      label: `Merge "sets" → "baby-sets-outfits" (${prods.length} products move)`,
      plan: [
        `  source:  slug="sets" id=${sets.id} (isActive=${sets.isActive})`,
        `  target:  slug="baby-sets-outfits" id=${babySets.id} (isActive=${babySets.isActive})`,
        `  products to move: ${prods.length}`,
        ...prods.map((pr) => `    - slug="${pr.slug}"`),
      ],
      execute: async (tx) => {
        const moved = await tx.product.updateMany({
          where: { categoryId: sets.id },
          data: { categoryId: babySets.id },
        })
        const del = await tx.category.delete({ where: { id: sets.id } })
        return [`products moved: ${moved.count}`, `sets category deleted: slug=${del.slug}`]
      },
    })
  } else if (!sets) {
    steps.push({
      label: '[SKIP] "sets" not found — already merged or never existed',
      plan: [],
      execute: async () => ['skipped'],
    })
  } else {
    throw new Error(`ABORT: "sets" found but "baby-sets-outfits" target missing — cannot merge`)
  }

  // ─── 4. Slug-only rename "herren-schuhe" → "herrenschuhe" ─
  // Option A1: URL gets the correct German compound spelling, but the
  // translations stay as-is ("Schuhe" / "Shoes" / "أحذية"). The admin's
  // tree view keeps the natural hierarchy "Herren > Schuhe" without
  // redundancy in breadcrumbs — same pattern as Damen/Mädchen/Jungen.
  if (herrenSchuhe && !herrenSchuheTarget) {
    const trans = await p.categoryTranslation.findMany({
      where: { categoryId: herrenSchuhe.id },
      select: { id: true, language: true, name: true },
    })
    const productCount = await p.product.count({ where: { categoryId: herrenSchuhe.id } })

    steps.push({
      label: `Slug-rename "herren-schuhe" → "herrenschuhe" (translations unchanged)`,
      plan: [
        `  slug: "herren-schuhe" → "herrenschuhe"`,
        `  products staying: ${productCount} (zero data move)`,
        `  translations UNCHANGED:`,
        ...trans.map((t) => `    - ${t.language}: "${t.name}" (stays)`),
      ],
      execute: async (tx) => {
        await tx.category.update({
          where: { id: herrenSchuhe.id },
          data: { slug: 'herrenschuhe' },
        })
        return [`slug updated: herren-schuhe → herrenschuhe`, `translations left untouched (Option A1)`]
      },
    })
  } else if (herrenSchuheTarget) {
    steps.push({
      label: '[SKIP] "herrenschuhe" already exists — rename already applied',
      plan: [],
      execute: async () => ['skipped (idempotent)'],
    })
  } else {
    steps.push({
      label: '[SKIP] "herren-schuhe" source not found',
      plan: [],
      execute: async () => ['skipped'],
    })
  }

  return steps
}

async function main() {
  console.log(SEP)
  console.log('CATEGORIES CLEANUP — PHASE 0')
  console.log('Mode:', APPLY ? 'APPLY (will write to DB)' : 'DRY-RUN (no writes)')
  console.log('Date:', new Date().toISOString())
  console.log(SEP)

  const steps = await buildPlan()

  // Print plan
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    console.log(`\n[${i + 1}] ${s.label}`)
    for (const line of s.plan) console.log(line)
  }

  if (!APPLY) {
    console.log('\n' + SEP)
    console.log('DRY-RUN complete. Pass --apply to execute.')
    console.log(SEP)
    await p.$disconnect()
    return
  }

  // Execute in one transaction
  console.log('\n' + SEP)
  console.log('APPLYING in $transaction...')
  console.log(SEP)

  const results = await p.$transaction(async (tx) => {
    const out: string[][] = []
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]
      const msgs = await s.execute(tx)
      out.push(msgs)
      console.log(`\n[${i + 1}] ${s.label}`)
      for (const m of msgs) console.log('   ✓ ' + m)
    }
    return out
  })

  console.log('\n' + SEP)
  console.log('APPLY complete. Running post-checks...')
  console.log(SEP)

  // Post-verify
  const postJacken = await p.category.findFirst({ where: { slug: 'jacken' } })
  const postSets = await p.category.findFirst({ where: { slug: 'sets' } })
  const postHerrenSchuhe = await p.category.findFirst({ where: { slug: 'herren-schuhe' } })
  const postHerrenschuhe = await p.category.findFirst({ where: { slug: 'herrenschuhe' } })
  const totalCats = await p.category.count()
  const activeCats = await p.category.count({ where: { isActive: true } })
  const totalProducts = await p.product.count()

  console.log('  "jacken" (should be null):        ', postJacken ? `STILL EXISTS (id=${postJacken.id})` : 'null ✓')
  console.log('  "sets"   (should be null):        ', postSets ? `STILL EXISTS (id=${postSets.id})` : 'null ✓')
  console.log('  "herren-schuhe" (should be null): ', postHerrenSchuhe ? `STILL EXISTS (id=${postHerrenSchuhe.id})` : 'null ✓')
  console.log('  "herrenschuhe"  (should exist):   ', postHerrenschuhe ? `id=${postHerrenschuhe.id} ✓` : 'MISSING')
  console.log('  total categories:     ', totalCats)
  console.log('  active categories:    ', activeCats)
  console.log('  total products:       ', totalProducts, '(was 96, expect 81 after zombie-cleanup)')

  await p.$disconnect()
  console.log('\nDONE.')
}

main().catch(async (e) => {
  console.error('\nFAILED:', e)
  await p.$disconnect().catch(() => {})
  process.exit(1)
})
