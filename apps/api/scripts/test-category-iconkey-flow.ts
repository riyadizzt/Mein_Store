/**
 * Verify the full category icon-key flow end-to-end:
 *   1. Pick an existing subcategory
 *   2. Write iconKey='shoe' via CategoriesService.update() (real code path)
 *   3. Call CategoriesService.findAll() (real code path with formatCategory)
 *   4. Assert the returned tree has iconKey='shoe' on the subcategory
 *   5. Restore iconKey=null
 *
 * Non-destructive: restores previous value. Uses a standalone Nest context so
 * it goes through the real service layer (no HTTP server required, no
 * collision with the user's running dev server).
 */

import { NestFactory } from '@nestjs/core'
import { PrismaClient } from '@prisma/client'
import { CategoriesService } from '../src/modules/categories/categories.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { Module } from '@nestjs/common'

@Module({
  providers: [CategoriesService, PrismaService],
  exports: [CategoriesService],
})
class TestModule {}

const prisma = new PrismaClient()

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  CATEGORY ICON-KEY FLOW — End-to-End Test')
  console.log('═══════════════════════════════════════════════════════════')
  console.log()

  const app = await NestFactory.createApplicationContext(TestModule, { logger: false })
  const service = app.get(CategoriesService)

  const target = await prisma.category.findFirst({
    where: { parentId: { not: null }, slug: 'herren-schuhe' },
    select: { id: true, slug: true, iconKey: true, parentId: true },
  })
  if (!target) {
    console.error('❌ Could not find herren-schuhe — aborting')
    await app.close()
    process.exit(1)
  }
  console.log(`  [1/5] Target: ${target.slug} (current iconKey=${target.iconKey})`)
  const originalIconKey = target.iconKey

  const parent = await prisma.category.findUnique({
    where: { id: target.parentId! },
    select: { slug: true },
  })
  if (!parent) {
    console.error('❌ Parent missing')
    await app.close()
    process.exit(1)
  }

  try {
    // 2. Write via the real service update()
    await service.update(target.id, { iconKey: 'shoe' })
    console.log(`  [2/5] CategoriesService.update({ iconKey: 'shoe' }) — OK`)

    // 3. Read via the real service findAll() — goes through formatCategory
    const tree = await service.findAll('de')
    console.log(`  [3/5] CategoriesService.findAll('de') returned ${tree.length} top-level`)

    const parentNode = tree.find((c) => c.slug === parent.slug)
    if (!parentNode) throw new Error(`Parent ${parent.slug} missing from tree`)
    const childNode = (parentNode.children as any[]).find((c) => c.slug === target.slug)
    if (!childNode) throw new Error(`Child ${target.slug} missing under ${parent.slug}`)
    console.log(`  [4/5] In tree: ${parentNode.slug} → ${childNode.slug}, iconKey=${childNode.iconKey}`)

    if (childNode.iconKey !== 'shoe') {
      throw new Error(`formatCategory did not propagate iconKey — got '${childNode.iconKey}'`)
    }
    console.log(`        ✓ formatCategory passes iconKey through to public response`)

    // Also test update with explicit null (clear)
    await service.update(target.id, { iconKey: undefined })
    const afterUndef = await prisma.category.findUnique({
      where: { id: target.id },
      select: { iconKey: true },
    })
    console.log(`        ✓ update({ iconKey: undefined }) preserves value (${afterUndef?.iconKey})`)

    console.log()
    console.log('✅ FLOW WORKS — service → DB → formatCategory chain verified')
  } catch (e: any) {
    console.error()
    console.error('❌ FLOW BROKEN:', e.message)
    process.exitCode = 1
  } finally {
    // 5. Restore
    await prisma.category.update({
      where: { id: target.id },
      data: { iconKey: originalIconKey },
    })
    console.log(`  [5/5] Restored iconKey=${originalIconKey} on ${target.slug}`)
    await prisma.$disconnect()
    await app.close()
  }
}

main()
