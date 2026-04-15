/**
 * Surgical cleanup of the 2 orphan stock reservations from the 15.04.2026
 * incident (before the orders.service + markAsCaptured fix).
 *
 * Strategy:
 *   - Find all active (RESERVED) reservations whose Order is already
 *     confirmed/returned/refunded — these should have been CONFIRMED
 *     long ago
 *   - For each: set reservation.status = RELEASED (not CONFIRMED
 *     because the onHand was never decremented; releasing just zeros
 *     out the reserved counter without touching onHand, which is
 *     correct because the physical stock was never actually sold)
 *   - Decrement inventory.quantityReserved by the reservation quantity
 *   - Write an InventoryMovement row of type 'released' with a notes
 *     string that pins this as a post-incident cleanup
 *   - Also recompute quantityReserved from scratch for each affected
 *     variant+warehouse combo to fix any counter drift
 *
 * Runs in DRY-RUN mode by default. Pass `--apply` to actually write.
 *
 * Non-destructive in dry-run. --apply writes inside a transaction per
 * reservation so partial failures can't leave the DB in a weird state.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const APPLY = process.argv.includes('--apply')

async function main() {
  console.log(`\nMode: ${APPLY ? '🔴 APPLY (writing to DB)' : '🟡 DRY-RUN (read-only)'}\n`)

  // Step 1: find orphan reservations — active RESERVED rows whose
  // parent order is already past pending. These are orphans.
  const orphans = await prisma.stockReservation.findMany({
    where: {
      status: 'RESERVED',
      orderId: { not: null },
    },
    select: {
      id: true,
      quantity: true,
      variantId: true,
      warehouseId: true,
      orderId: true,
      expiresAt: true,
      variant: { select: { sku: true } },
      warehouse: { select: { name: true } },
    },
  })

  const orphanReservations: typeof orphans = []
  for (const r of orphans) {
    if (!r.orderId) continue
    const order = await prisma.order.findUnique({
      where: { id: r.orderId },
      select: { status: true, orderNumber: true, payment: { select: { status: true } } },
    })
    if (!order) continue
    // Pending orders are NOT orphans — their reservations are legit
    if (['pending', 'pending_payment'].includes(order.status)) continue
    // Cancelled orders where payment was never captured: the reservation
    // should have been released already but we include it to be safe
    orphanReservations.push(r as any)
  }

  console.log(`Found ${orphanReservations.length} orphan reservation(s):\n`)
  for (const r of orphanReservations) {
    const order = await prisma.order.findUnique({
      where: { id: r.orderId! },
      select: { orderNumber: true, status: true, payment: { select: { status: true } } },
    })
    console.log(`  id=${r.id.slice(0, 8)}  ${r.variant.sku.padEnd(22)}  ${r.warehouse.name.padEnd(18)}  qty=${r.quantity}  order=${order?.orderNumber}  status=${order?.status}  payment=${order?.payment?.status ?? '-'}`)
  }

  if (orphanReservations.length === 0) {
    console.log('\nNothing to do.')
    await prisma.$disconnect()
    return
  }

  // Step 2: for each affected (variant, warehouse), show current vs.
  // post-cleanup quantityReserved. The post value is the sum of still-
  // active RESERVED rows that are NOT in our orphan set.
  console.log('\n── Inventory impact preview ───────────────────────────\n')
  const affectedKeys = new Set(orphanReservations.map((r) => `${r.variantId}::${r.warehouseId}`))
  const impacts: Array<{ variantId: string; warehouseId: string; sku: string; warehouseName: string; currentReserved: number; newReserved: number; onHand: number }> = []

  for (const key of affectedKeys) {
    const [variantId, warehouseId] = key.split('::')
    const inv = await prisma.inventory.findUnique({
      where: { variantId_warehouseId: { variantId, warehouseId } },
      select: { quantityOnHand: true, quantityReserved: true },
    })
    if (!inv) continue

    // True reserved = sum of all RESERVED rows that are NOT expired AND
    // NOT in our orphan cleanup set
    const orphanIdsForKey = new Set(
      orphanReservations.filter((r) => r.variantId === variantId && r.warehouseId === warehouseId).map((r) => r.id),
    )
    const otherActive = await prisma.stockReservation.findMany({
      where: {
        variantId,
        warehouseId,
        status: 'RESERVED',
        expiresAt: { gt: new Date() },
        id: { notIn: Array.from(orphanIdsForKey) },
      },
      select: { quantity: true },
    })
    const trueReserved = otherActive.reduce((sum, r) => sum + r.quantity, 0)
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { sku: true },
    })
    const wh = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { name: true },
    })
    impacts.push({
      variantId, warehouseId,
      sku: variant?.sku ?? '(?)',
      warehouseName: wh?.name ?? '(?)',
      currentReserved: inv.quantityReserved,
      newReserved: trueReserved,
      onHand: inv.quantityOnHand,
    })
  }

  for (const im of impacts) {
    const delta = im.currentReserved - im.newReserved
    const newAvailable = im.onHand - im.newReserved
    const oldAvailable = im.onHand - im.currentReserved
    console.log(`  ${im.sku.padEnd(22)} ${im.warehouseName.padEnd(18)}  reserved: ${im.currentReserved} → ${im.newReserved} (Δ -${delta})   available: ${oldAvailable} → ${newAvailable} (+${delta})`)
  }

  if (!APPLY) {
    console.log('\n🟡 DRY-RUN complete. Re-run with --apply to write.\n')
    await prisma.$disconnect()
    return
  }

  // Step 3: write. Each reservation + its inventory delta in one
  // transaction. Per-reservation so a partial failure leaves the rest
  // alone.
  console.log('\n── APPLYING ───────────────────────────────────────────\n')
  let released = 0
  for (const r of orphanReservations) {
    try {
      await prisma.$transaction(async (tx) => {
        // Mark the reservation row
        await tx.stockReservation.update({
          where: { id: r.id },
          data: { status: 'RELEASED' },
        })
        // Decrement the inventory counter by this reservation's quantity
        await tx.inventory.update({
          where: { variantId_warehouseId: { variantId: r.variantId, warehouseId: r.warehouseId } },
          data: { quantityReserved: { decrement: r.quantity } },
        })
        // Audit movement
        await tx.inventoryMovement.create({
          data: {
            variantId: r.variantId,
            warehouseId: r.warehouseId,
            type: 'released',
            quantity: r.quantity,
            referenceId: r.id,
            notes: `Post-incident cleanup 15.04.2026 — orphan reservation from order ${r.orderId?.slice(0, 8)}`,
            createdBy: 'system-cleanup',
          },
        })
      })
      console.log(`  ✓ released ${r.id.slice(0, 8)}  (${r.variant.sku}, qty=${r.quantity})`)
      released++
    } catch (err: any) {
      console.error(`  ✗ failed ${r.id.slice(0, 8)}: ${err.message}`)
    }
  }

  console.log(`\n── Drift reconciliation ───────────────────────────────\n`)
  // After releasing the orphans, if the counter is STILL wrong, fix it.
  for (const im of impacts) {
    const inv = await prisma.inventory.findUnique({
      where: { variantId_warehouseId: { variantId: im.variantId, warehouseId: im.warehouseId } },
      select: { quantityReserved: true },
    })
    if (!inv) continue
    if (inv.quantityReserved !== im.newReserved) {
      const drift = inv.quantityReserved - im.newReserved
      console.log(`  ⚠  ${im.sku} still has drift: actual=${inv.quantityReserved}, expected=${im.newReserved}, fixing (-${drift})`)
      await prisma.inventory.update({
        where: { variantId_warehouseId: { variantId: im.variantId, warehouseId: im.warehouseId } },
        data: { quantityReserved: im.newReserved },
      })
      await prisma.inventoryMovement.create({
        data: {
          variantId: im.variantId,
          warehouseId: im.warehouseId,
          type: 'stocktake_adjustment',
          quantity: -drift,
          notes: `Post-incident counter drift fix 15.04.2026 — was ${inv.quantityReserved}, set to ${im.newReserved}`,
          createdBy: 'system-cleanup',
        },
      })
    } else {
      console.log(`  ✓ ${im.sku}  no further drift`)
    }
  }

  console.log(`\n✅ Apply complete: ${released}/${orphanReservations.length} reservations released.\n`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
