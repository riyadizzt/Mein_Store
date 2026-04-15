/**
 * LIVE e2e: reproduces the exact SKU-collision scenario that blocked the
 * user earlier and verifies the resolver now auto-suffixes instead of
 * throwing 500.
 *
 * Non-destructive: creates a throwaway product, then a second one that
 * collides with the first, asserts the response carries `skuAdjustments`,
 * then deletes both + the audit rows.
 */
import { NestFactory } from '@nestjs/core'
import { ProductsService } from '../src/modules/products/products.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { AppModule } from '../src/app.module'

const PASS = (m: string) => console.log(`✅ ${m}`)
const FAIL = (m: string) => { console.error(`❌ ${m}`); process.exitCode = 1 }

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  const productsService = app.get(ProductsService)
  const prisma = app.get(PrismaService)

  const createdProductIds: string[] = []

  try {
    const category = await prisma.category.findFirst({ where: { isActive: true } })
    if (!category) { FAIL('No active category'); return }

    const unique = Date.now().toString().slice(-6)
    const baseSku = `MAL-COLLIDE${unique}-ROT-S`

    console.log(`\n── 1. First create — fresh SKU ────────────────────\n`)
    const first: any = await productsService.create({
      slug: `sku-collide-first-${unique}`,
      categoryId: category.id,
      basePrice: 49.99,
      translations: [
        { language: 'de', name: 'Kollisions-Test 1' },
        { language: 'en', name: 'Collision Test 1' },
        { language: 'ar', name: 'اختبار التعارض 1' },
      ],
      variants: [
        { sku: baseSku, color: 'Rot', size: 'S' } as any,
      ],
    } as any)
    createdProductIds.push(first.id)

    if (first.variants[0].sku === baseSku) PASS(`First variant keeps raw SKU: ${baseSku}`)
    else FAIL(`First variant was suffixed unexpectedly: ${first.variants[0].sku}`)

    if (Array.isArray(first.skuAdjustments) && first.skuAdjustments.length === 0) {
      PASS('First create returns empty skuAdjustments')
    } else {
      FAIL(`First create unexpected adjustments: ${JSON.stringify(first.skuAdjustments)}`)
    }

    console.log(`\n── 2. Second create — same base SKU → should suffix ─\n`)
    const second: any = await productsService.create({
      slug: `sku-collide-second-${unique}`,
      categoryId: category.id,
      basePrice: 49.99,
      translations: [
        { language: 'de', name: 'Kollisions-Test 2' },
        { language: 'en', name: 'Collision Test 2' },
        { language: 'ar', name: 'اختبار التعارض 2' },
      ],
      variants: [
        { sku: baseSku, color: 'Rot', size: 'S' } as any, // collision!
      ],
    } as any)
    createdProductIds.push(second.id)

    const expectedSku = `${baseSku}-002`
    if (second.variants[0].sku === expectedSku) PASS(`Second variant auto-suffixed to ${expectedSku}`)
    else FAIL(`Expected ${expectedSku}, got ${second.variants[0].sku}`)

    // Verify barcode also uses the final (suffixed) SKU
    if (second.variants[0].barcode === expectedSku) {
      PASS('Barcode matches the final (suffixed) SKU — invariant preserved')
    } else {
      FAIL(`Barcode drift: sku=${second.variants[0].sku}, barcode=${second.variants[0].barcode}`)
    }

    // Verify the response carries the adjustment list
    if (Array.isArray(second.skuAdjustments) && second.skuAdjustments.length === 1) {
      const adj = second.skuAdjustments[0]
      if (adj.original === baseSku && adj.final === expectedSku) {
        PASS(`skuAdjustments[0] = { ${adj.original} → ${adj.final} }`)
      } else {
        FAIL(`adjustment payload wrong: ${JSON.stringify(adj)}`)
      }
    } else {
      FAIL(`Expected 1 adjustment, got ${JSON.stringify(second.skuAdjustments)}`)
    }

    console.log(`\n── 3. Third create — collides again → -003 ─────────\n`)
    const third: any = await productsService.create({
      slug: `sku-collide-third-${unique}`,
      categoryId: category.id,
      basePrice: 49.99,
      translations: [
        { language: 'de', name: 'Kollisions-Test 3' },
        { language: 'en', name: 'Collision Test 3' },
        { language: 'ar', name: 'اختبار التعارض 3' },
      ],
      variants: [
        { sku: baseSku, color: 'Rot', size: 'S' } as any,
      ],
    } as any)
    createdProductIds.push(third.id)

    if (third.variants[0].sku === `${baseSku}-003`) {
      PASS(`Third variant auto-suffixed to ${baseSku}-003 (chain works)`)
    } else {
      FAIL(`Expected ${baseSku}-003, got ${third.variants[0].sku}`)
    }

    console.log(`\n── 4. Multi-variant create with mixed collisions ────\n`)
    // One variant collides with existing, two are fresh
    const mixed: any = await productsService.create({
      slug: `sku-collide-mixed-${unique}`,
      categoryId: category.id,
      basePrice: 49.99,
      translations: [
        { language: 'de', name: 'Kollisions-Test 4' },
        { language: 'en', name: 'Collision Test 4' },
        { language: 'ar', name: 'اختبار التعارض 4' },
      ],
      variants: [
        { sku: baseSku, color: 'Rot', size: 'S' } as any,        // collides (3x now)
        { sku: `MAL-COLLIDE${unique}-ROT-M`, color: 'Rot', size: 'M' } as any, // fresh
        { sku: `MAL-COLLIDE${unique}-ROT-L`, color: 'Rot', size: 'L' } as any, // fresh
      ],
    } as any)
    createdProductIds.push(mixed.id)

    if (mixed.variants.length === 3) PASS('All 3 variants created')
    else FAIL(`Expected 3 variants, got ${mixed.variants.length}`)

    const skus = mixed.variants.map((v: any) => v.sku).sort()
    const expectedSkus = [
      `${baseSku}-004`,
      `MAL-COLLIDE${unique}-ROT-L`,
      `MAL-COLLIDE${unique}-ROT-M`,
    ].sort()
    if (JSON.stringify(skus) === JSON.stringify(expectedSkus)) {
      PASS(`SKUs correct: ${skus.join(', ')}`)
    } else {
      FAIL(`SKUs wrong:\n  got:      ${skus.join(', ')}\n  expected: ${expectedSkus.join(', ')}`)
    }

    if (mixed.skuAdjustments.length === 1) {
      PASS('Only 1 adjustment reported (the -S one)')
    } else {
      FAIL(`Expected 1 adjustment, got ${mixed.skuAdjustments.length}`)
    }
  } finally {
    if (createdProductIds.length > 0) {
      console.log(`\n── Teardown: deleting ${createdProductIds.length} test products ──\n`)
      for (const id of createdProductIds) {
        try {
          await prisma.product.delete({ where: { id } })
          console.log(`  ✓ deleted ${id.slice(-8)}`)
        } catch (e: any) {
          console.error(`  ✗ ${id.slice(-8)}: ${e.message}`)
        }
      }
    }
    await app.close()
  }

  if (process.exitCode === 1) {
    console.log('\n❌ Some checks FAILED')
  } else {
    console.log('\n✅ All live SKU-resolver checks passed')
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
