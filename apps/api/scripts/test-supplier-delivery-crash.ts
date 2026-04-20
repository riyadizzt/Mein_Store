/**
 * Live Supabase E2E for the transaction-rollback guarantee on Wareneingang.
 *
 * Simulates a mid-flow failure inside the createDelivery write block and
 * verifies that Prisma rolls back cleanly: no SupplierDelivery, no
 * SupplierDeliveryItem, no InventoryMovement, and no inventory increment.
 *
 * Mechanism: we run the same atomic shape the service uses
 * ($transaction(async tx => {...})), but deliberately throw after the
 * first inventory.update() + InventoryMovement.create() to prove the
 * whole block undoes.
 *
 * Exit 0 if rollback is clean. Exit 1 on any residue.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client')

async function main() {
  const prisma = new PrismaClient()
  let supplierId: string | null = null
  let failures = 0
  const attemptedDeliveryNumber = `E2E-CRASH-${Date.now()}`

  function pass(msg: string) { console.log(`  ✓ ${msg}`) }
  function fail(msg: string) { console.error(`  ✗ ${msg}`); failures++ }

  try {
    // Seed: throwaway supplier + pick an existing variant to use
    const supplier = await prisma.supplier.create({ data: { name: `E2E-CRASH-${Date.now()}` } })
    supplierId = supplier.id
    const variant = await prisma.productVariant.findFirst({
      where: { isActive: true, inventory: { some: {} } },
      include: { inventory: { take: 1 } },
    })
    if (!variant) throw new Error('no variant with inventory')
    const targetWarehouseId = variant.inventory[0].warehouseId
    const before = variant.inventory[0].quantityOnHand
    console.log(`[seed] supplier=${supplier.id.slice(0, 8)}  variant=${variant.sku}  before=${before}`)

    // Deliberately fail the transaction after partial writes
    console.log('\n[test] throwing mid-transaction to force rollback')
    let caught: any = null
    try {
      await prisma.$transaction(async (tx: any) => {
        const d = await tx.supplierDelivery.create({
          data: {
            supplierId: supplier.id,
            deliveryNumber: attemptedDeliveryNumber,
            totalAmount: 0, itemCount: 1, status: 'received',
            items: {
              create: [{
                variantId: variant.id, productId: variant.productId,
                isNewProduct: false,
                productName: variant.sku, sku: variant.sku,
                color: variant.color, size: variant.size,
                quantity: 7, unitCost: 1, totalCost: 7,
              }],
            },
          },
          include: { items: true },
        })
        await tx.inventory.update({
          where: { variantId_warehouseId: { variantId: variant.id, warehouseId: targetWarehouseId } },
          data: { quantityOnHand: { increment: 7 } },
        })
        await tx.inventoryMovement.create({
          data: {
            variantId: variant.id,
            warehouseId: targetWarehouseId,
            type: 'supplier_delivery',
            quantity: 7,
            quantityBefore: before,
            quantityAfter: before + 7,
            referenceId: d.items[0].id,
            notes: 'E2E crash — should roll back',
            createdBy: 'e2e-script',
          },
        })
        // All partial writes done — NOW throw to trigger rollback
        throw new Error('simulated crash mid-transaction')
      })
    } catch (e: any) {
      caught = e
    }

    if (caught && caught.message.includes('simulated crash')) {
      pass('transaction threw as expected')
    } else {
      fail(`expected thrown error, got ${caught}`)
    }

    // Verify clean rollback at DB level
    const leftoverDelivery = await prisma.supplierDelivery.findUnique({
      where: { deliveryNumber: attemptedDeliveryNumber },
    })
    if (!leftoverDelivery) {
      pass('no SupplierDelivery persisted — rolled back')
    } else {
      fail(`SupplierDelivery ${attemptedDeliveryNumber} survived rollback`)
    }

    const leftoverMovs = await prisma.inventoryMovement.count({
      where: { notes: 'E2E crash — should roll back' },
    })
    if (leftoverMovs === 0) {
      pass('no InventoryMovement persisted — rolled back')
    } else {
      fail(`${leftoverMovs} InventoryMovement survived rollback`)
    }

    const afterInv = await prisma.inventory.findFirst({
      where: { variantId: variant.id, warehouseId: targetWarehouseId },
    })
    if (afterInv && afterInv.quantityOnHand === before) {
      pass(`inventory.quantityOnHand unchanged (${before}) — rolled back`)
    } else {
      fail(`inventory quantityOnHand changed: before=${before} after=${afterInv?.quantityOnHand}`)
    }
  } catch (e: any) {
    console.error('[fatal]', e?.message ?? e)
    failures++
  } finally {
    try {
      if (supplierId) await prisma.supplier.delete({ where: { id: supplierId } })
    } catch {}
    await prisma.$disconnect()
  }

  if (failures > 0) {
    console.error(`\n✗ ${failures} assertion(s) failed`)
    process.exit(1)
  }
  console.log('\n✓ transaction rollback integrity verified')
  process.exit(0)
}

main()
