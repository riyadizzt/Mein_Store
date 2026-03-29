/**
 * Seed ONLY Inventory — creates inventory records for all variants that don't have one.
 * Does NOT delete any existing data.
 *
 * Usage: npx ts-node apps/api/prisma/seed-inventory.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('📦 Inventory Seed gestartet...\n')

  // Get or create default warehouse
  let warehouse = await prisma.warehouse.findFirst({ where: { isDefault: true } })
  if (!warehouse) {
    warehouse = await prisma.warehouse.create({
      data: { name: 'Hauptlager', type: 'WAREHOUSE', isDefault: true },
    })
    console.log('🏭 Hauptlager erstellt')
  }
  console.log(`🏭 Lager: ${warehouse.name} (${warehouse.id})`)

  // Get all variants
  const variants = await prisma.productVariant.findMany({
    select: { id: true, sku: true },
  })
  console.log(`👕 ${variants.length} Varianten gefunden`)

  // Check which already have inventory
  const existingInventory = await prisma.inventory.findMany({
    select: { variantId: true, warehouseId: true },
  })
  const existingSet = new Set(existingInventory.map((i) => `${i.variantId}:${i.warehouseId}`))
  console.log(`📊 ${existingInventory.length} bestehende Inventory-Einträge`)

  // Create missing inventory records
  let created = 0
  for (const variant of variants) {
    const key = `${variant.id}:${warehouse.id}`
    if (existingSet.has(key)) continue

    const qty = 5 + Math.floor(Math.random() * 45) // 5-50 Stück
    await prisma.inventory.create({
      data: {
        variantId: variant.id,
        warehouseId: warehouse.id,
        quantityOnHand: qty,
        quantityReserved: 0,
        reorderPoint: 5,
      },
    })
    created++
  }

  console.log(`\n✅ ${created} neue Inventory-Einträge erstellt`)
  console.log(`   Bestehende Daten: NICHT verändert`)
  console.log(`   Lager: ${warehouse.name}`)
  console.log(`   Bestand: 5-50 Stück pro Variante`)
  console.log(`   Mindestbestand: 5`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
