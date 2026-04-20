/**
 * One-shot backfill for existing ProductVariants that are missing
 * Inventory rows in non-default warehouses.
 *
 * Before Gruppe 2: addColor/addSize/product-create wrote one Inventory
 * row in the default warehouse. Products in multi-warehouse deployments
 * accumulated variants that are "invisible" in the store/shop warehouse
 * until an admin manually bookmarks a zero-qty row.
 *
 * After Gruppe 2: new variants are seeded in every active warehouse by
 * seedInventoryAcrossWarehouses. This script plugs the gap for variants
 * that were created BEFORE Gruppe 2 shipped.
 *
 * Safety
 * ------
 *   * Dry-run by default. --apply needed to write.
 *   * Never modifies existing Inventory rows — only creates missing
 *     (variantId, warehouseId) pairs with quantityOnHand=0.
 *   * Idempotent: a second run against the same DB is a no-op.
 *   * Only touches ACTIVE variants + ACTIVE warehouses. Soft-deleted
 *     products and inactive warehouses are ignored.
 *   * No GoBD-relevant tables touched. Invoices / credit-notes /
 *     inventory_movements untouched.
 *
 * Usage
 * -----
 *   # Preview (no writes):
 *   npx tsx scripts/backfill-inventory-multi-warehouse.ts
 *   # Apply:
 *   npx tsx scripts/backfill-inventory-multi-warehouse.ts --apply
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client')

const APPLY = process.argv.includes('--apply')

async function main() {
  const prisma = new PrismaClient()

  console.log(APPLY ? '=== APPLY MODE — will write ===' : '=== DRY RUN — no writes ===')
  console.log('')

  const warehouses = await prisma.warehouse.findMany({
    where: { isActive: true },
    select: { id: true, name: true, isDefault: true },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  })
  if (warehouses.length <= 1) {
    console.log(`Only ${warehouses.length} active warehouse(s) — nothing to backfill.`)
    await prisma.$disconnect()
    return
  }

  console.log(`Active warehouses (${warehouses.length}):`)
  for (const w of warehouses) {
    console.log(`  ${w.isDefault ? '★' : ' '} ${w.name}  id=${w.id.slice(0, 8)}`)
  }
  console.log('')

  // All active variants, with their current inventory row list
  const variants = await prisma.productVariant.findMany({
    where: { isActive: true, product: { deletedAt: null } },
    select: {
      id: true,
      sku: true,
      inventory: { select: { warehouseId: true } },
    },
  })

  const whIds = warehouses.map((w: any) => w.id)
  type Gap = { variantId: string; sku: string | null; missingIn: string[] }
  const gaps: Gap[] = []

  for (const v of variants) {
    const haveWhs = new Set(v.inventory.map((i: any) => i.warehouseId))
    const missingIn = whIds.filter((id: string) => !haveWhs.has(id))
    if (missingIn.length > 0) {
      gaps.push({ variantId: v.id, sku: v.sku, missingIn })
    }
  }

  if (gaps.length === 0) {
    console.log('✓ No gaps — every active variant already has rows in every active warehouse.')
    await prisma.$disconnect()
    return
  }

  const totalRowsToCreate = gaps.reduce((s, g) => s + g.missingIn.length, 0)
  console.log(`Found ${gaps.length} variants missing rows in some warehouses.`)
  console.log(`Total Inventory rows to create: ${totalRowsToCreate}`)
  console.log('')

  const preview = gaps.slice(0, 10)
  console.log(`Preview (first ${preview.length}):`)
  for (const g of preview) {
    const whNames = g.missingIn.map((id: string) => {
      const w = warehouses.find((x: any) => x.id === id)
      return w?.name ?? id.slice(0, 8)
    })
    console.log(`  ${g.sku ?? '(no sku)'}  missing in: ${whNames.join(', ')}`)
  }
  if (gaps.length > 10) console.log(`  ... ${gaps.length - 10} more`)
  console.log('')

  if (!APPLY) {
    console.log('ℹ Dry-run complete. Re-run with --apply to create the rows.')
    await prisma.$disconnect()
    return
  }

  // Apply: create rows in batches to avoid long-lived transactions
  console.log('Creating missing rows...')
  let created = 0
  for (const g of gaps) {
    for (const whId of g.missingIn) {
      try {
        await prisma.inventory.create({
          data: { variantId: g.variantId, warehouseId: whId, quantityOnHand: 0 },
        })
        created++
      } catch (e: any) {
        // If a row was created by a parallel writer between findMany and
        // insert, Prisma throws P2002 on (variantId, warehouseId) compound
        // unique — that's fine, skip. Any other error propagates.
        if (e?.code !== 'P2002') throw e
      }
    }
  }
  console.log(`✓ Created ${created} inventory row(s) (target was ${totalRowsToCreate}).`)

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error('Script failed:', err)
  process.exit(1)
})
