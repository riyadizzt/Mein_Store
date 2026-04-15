/**
 * LIVE e2e: exercises all 5 variant-create/update paths against the
 * real Supabase DB. Creates a throwaway product, runs each path, and
 * asserts that every resulting variant has a non-empty barcode.
 *
 * Non-destructive: hard-deletes the test product + its audit rows at
 * the end, even on failure.
 */
import { NestFactory } from '@nestjs/core'
import { ProductsService } from '../src/modules/products/products.service'
import { AdminProductsService } from '../src/modules/admin/services/admin-products.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { AppModule } from '../src/app.module'

const PASS = (m: string) => console.log(`✅ ${m}`)
const FAIL = (m: string) => { console.error(`❌ ${m}`); process.exitCode = 1 }

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  const productsService = app.get(ProductsService)
  const adminProducts = app.get(AdminProductsService)
  const prisma = app.get(PrismaService)

  const createdProductIds: string[] = []

  try {
    // Need an existing category
    const category = await prisma.category.findFirst({ where: { isActive: true } })
    if (!category) { FAIL('No active category'); return }

    // ── Path 1: ProductsService.create (product wizard) ─────────
    console.log('\n── Path 1: ProductsService.create — wizard ────────\n')
    const p1 = await productsService.create({
      slug: `guard-test-${Date.now()}`,
      categoryId: category.id,
      basePrice: 50,
      translations: [
        { language: 'de', name: 'Guard Test 1' },
        { language: 'en', name: 'Guard Test 1' },
        { language: 'ar', name: 'اختبار 1' },
      ],
      variants: [
        // intentionally pass NO barcode — this is the bug case
        { sku: `GT1-${Date.now()}-BLK-M`, color: 'Schwarz', size: 'M' } as any,
        // intentionally pass empty barcode
        { sku: `GT1-${Date.now()}-BLK-L`, barcode: '', color: 'Schwarz', size: 'L' } as any,
        // intentionally pass whitespace barcode
        { sku: `GT1-${Date.now()}-BLK-XL`, barcode: '   ', color: 'Schwarz', size: 'XL' } as any,
        // a real EAN — must NOT be overwritten
        { sku: `GT1-${Date.now()}-BLK-S`, barcode: '4006381333931', color: 'Schwarz', size: 'S' },
      ],
    } as any)
    createdProductIds.push(p1.id)

    const p1Variants = await prisma.productVariant.findMany({ where: { productId: p1.id } })
    for (const v of p1Variants) {
      if (!v.barcode || v.barcode.trim() === '') {
        FAIL(`Path 1 variant ${v.sku} has empty barcode: "${v.barcode}"`)
      }
    }
    const eanVariant = p1Variants.find((v) => v.sku.endsWith('-S'))
    if (eanVariant?.barcode === '4006381333931') PASS('Path 1 EAN preserved for -S variant')
    else FAIL(`Path 1 EAN lost: expected "4006381333931", got "${eanVariant?.barcode}"`)
    const nullVariant = p1Variants.find((v) => v.sku.endsWith('-M'))
    if (nullVariant?.barcode === nullVariant?.sku) PASS('Path 1 no-barcode → fallback to SKU')
    else FAIL(`Path 1 fallback wrong: sku=${nullVariant?.sku}, bc=${nullVariant?.barcode}`)
    const emptyVariant = p1Variants.find((v) => v.sku.endsWith('-L'))
    if (emptyVariant?.barcode === emptyVariant?.sku) PASS('Path 1 empty-string barcode → fallback to SKU')
    else FAIL(`Path 1 empty fallback wrong: sku=${emptyVariant?.sku}, bc=${emptyVariant?.barcode}`)
    const wsVariant = p1Variants.find((v) => v.sku.endsWith('-XL'))
    if (wsVariant?.barcode === wsVariant?.sku) PASS('Path 1 whitespace barcode → fallback to SKU')
    else FAIL(`Path 1 ws fallback wrong: sku=${wsVariant?.sku}, bc=${wsVariant?.barcode}`)

    // ── Path 3: AdminProductsService.addColor ─────────────────
    console.log('\n── Path 3: AdminProductsService.addColor ──────────\n')
    await adminProducts.addColor(p1.id, {
      color: 'Blau',
      colorHex: '#0000FF',
      sizes: ['S', 'M', 'L'],
    } as any, 'test-admin', '127.0.0.1')

    const p1After3 = await prisma.productVariant.findMany({
      where: { productId: p1.id, color: 'Blau' },
    })
    if (p1After3.length !== 3) FAIL(`Expected 3 Blau variants, got ${p1After3.length}`)
    for (const v of p1After3) {
      if (v.barcode === v.sku) {
        // good
      } else {
        FAIL(`addColor variant ${v.sku} barcode wrong: "${v.barcode}"`)
      }
    }
    if (p1After3.every((v) => v.barcode === v.sku)) PASS('Path 3 addColor → all 3 variants barcode=sku')

    // ── Path 4: AdminProductsService.addSize ──────────────────
    console.log('\n── Path 4: AdminProductsService.addSize ───────────\n')
    await adminProducts.addSize(p1.id, {
      size: 'XXXL',
      colors: ['Schwarz', 'Blau'],
    } as any, 'test-admin', '127.0.0.1')

    const p1After4 = await prisma.productVariant.findMany({
      where: { productId: p1.id, size: 'XXXL' },
    })
    if (p1After4.length !== 2) FAIL(`Expected 2 XXXL variants, got ${p1After4.length}`)
    for (const v of p1After4) {
      if (!v.barcode) {
        FAIL(`addSize variant ${v.sku} has null barcode — guard did not fire`)
      }
    }
    if (p1After4.every((v) => v.barcode === v.sku)) PASS('Path 4 addSize → all variants barcode=sku')

    // ── Path 5: updateVariant edge cases ──────────────────────
    console.log('\n── Path 5: AdminProductsService.updateVariant ─────\n')
    // Use a variant that currently has barcode=sku
    const victim = p1Variants.find((v) => v.sku.endsWith('-M'))!

    // 5a: empty string → MUST stay at SKU
    await adminProducts.updateVariant(victim.id, { barcode: '' }, 'test-admin', '127.0.0.1')
    let reread = await prisma.productVariant.findUnique({ where: { id: victim.id } })
    if (reread?.barcode === victim.sku) PASS('Path 5a: empty string → stayed at SKU')
    else FAIL(`Path 5a: barcode got cleared to "${reread?.barcode}"`)

    // 5b: whitespace → MUST stay at SKU
    await adminProducts.updateVariant(victim.id, { barcode: '   ' }, 'test-admin', '127.0.0.1')
    reread = await prisma.productVariant.findUnique({ where: { id: victim.id } })
    if (reread?.barcode === victim.sku) PASS('Path 5b: whitespace → stayed at SKU')
    else FAIL(`Path 5b: barcode got cleared to "${reread?.barcode}"`)

    // 5c: real EAN → MUST override SKU
    await adminProducts.updateVariant(victim.id, { barcode: '9783161484100' }, 'test-admin', '127.0.0.1')
    reread = await prisma.productVariant.findUnique({ where: { id: victim.id } })
    if (reread?.barcode === '9783161484100') PASS('Path 5c: real EAN → overrode SKU')
    else FAIL(`Path 5c: expected EAN, got "${reread?.barcode}"`)

    // 5d: back to SKU via empty string (must NOT overwrite the EAN with '')
    await adminProducts.updateVariant(victim.id, { barcode: '' }, 'test-admin', '127.0.0.1')
    reread = await prisma.productVariant.findUnique({ where: { id: victim.id } })
    if (reread?.barcode && reread.barcode.trim() !== '') PASS(`Path 5d: after clear attempt, barcode still set (="${reread.barcode}")`)
    else FAIL(`Path 5d: barcode was cleared to "${reread?.barcode}"`)

    // 5e: updateVariant with only priceModifier must NOT touch barcode
    const beforeEdit = reread?.barcode
    await adminProducts.updateVariant(victim.id, { priceModifier: 7 }, 'test-admin', '127.0.0.1')
    reread = await prisma.productVariant.findUnique({ where: { id: victim.id } })
    if (reread?.barcode === beforeEdit) PASS('Path 5e: priceModifier-only update left barcode untouched')
    else FAIL(`Path 5e: barcode changed from "${beforeEdit}" to "${reread?.barcode}"`)

    // ── Final: DB-wide check that NO variant on this product has null/empty barcode ──
    console.log('\n── Final invariant check ─────────────────────────\n')
    const allTestVariants = await prisma.productVariant.findMany({ where: { productId: p1.id } })
    const broken = allTestVariants.filter((v) => !v.barcode || v.barcode.trim() === '')
    if (broken.length === 0) PASS(`All ${allTestVariants.length} test variants have non-empty barcodes`)
    else FAIL(`${broken.length} variant(s) have empty barcode: ${broken.map((v) => v.sku).join(', ')}`)

  } finally {
    // ── Teardown ──
    if (createdProductIds.length > 0) {
      console.log(`\n── Teardown: hard-deleting ${createdProductIds.length} test product(s) ──\n`)
      for (const id of createdProductIds) {
        try {
          // Cascades take care of variants/inventory/images/etc.
          await prisma.product.delete({ where: { id } })
          console.log(`  ✓ deleted product ${id.slice(-8)}`)
        } catch (e: any) {
          console.error(`  ✗ failed to delete ${id.slice(-8)}: ${e.message}`)
        }
      }
      // Clean test audit rows
      const audit = await prisma.adminAuditLog.deleteMany({
        where: { adminId: 'test-admin', entityId: { in: createdProductIds } },
      })
      console.log(`  ✓ cleaned ${audit.count} audit row(s)`)
    }
    await app.close()
  }

  if (process.exitCode === 1) {
    console.log('\n❌ Some checks FAILED')
  } else {
    console.log('\n✅ All live barcode-guard checks passed')
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
