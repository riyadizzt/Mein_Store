/**
 * Release the one phantom reservation on ORD-20260415-000006.
 * Test data cleanup. Option A from the chat:
 *   - Mark the RESERVED row as RELEASED
 *   - Decrement inventory.quantityReserved by 1
 *   - Leave onHand alone (user will reconcile physically if needed)
 *
 * Runs in a single transaction. Prints before/after for audit.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const RESERVATION_ID_PREFIX = 'fcbe3fd3' // from inspect-order-006.ts
  const ORDER_NUMBER = 'ORD-20260415-000006'

  // Re-find the reservation by order number to be resilient to id truncation
  const order = await prisma.order.findFirst({
    where: { orderNumber: ORDER_NUMBER },
    select: { id: true, status: true },
  })
  if (!order) throw new Error(`Order ${ORDER_NUMBER} not found`)
  if (order.status !== 'delivered') {
    throw new Error(`Refusing to release: order status is "${order.status}", expected "delivered"`)
  }

  const reservations = await prisma.stockReservation.findMany({
    where: { orderId: order.id, status: 'RESERVED' },
  })

  if (reservations.length === 0) {
    console.log('ℹ  No RESERVED rows for this order — already clean')
    await prisma.$disconnect()
    return
  }
  if (reservations.length > 1) {
    console.log(`⚠  Found ${reservations.length} RESERVED rows — processing all`)
  }

  console.log('\n── BEFORE ──\n')
  for (const r of reservations) {
    console.log(`  reservation ${r.id.slice(0, 8)}  qty=${r.quantity}  status=${r.status}`)
    if (!r.id.startsWith(RESERVATION_ID_PREFIX)) {
      console.log(`  ⚠  id prefix ${r.id.slice(0, 8)} ≠ expected ${RESERVATION_ID_PREFIX} — continuing anyway`)
    }
    const inv = await prisma.inventory.findFirst({
      where: { variantId: r.variantId, warehouseId: r.warehouseId },
      select: { id: true, quantityOnHand: true, quantityReserved: true },
    })
    if (inv) {
      console.log(`  inventory ${inv.id.slice(0, 8)}  onHand=${inv.quantityOnHand}  reserved=${inv.quantityReserved}  available=${inv.quantityOnHand - inv.quantityReserved}`)
    }
  }

  console.log('\n── Applying fix in a transaction ──\n')
  await prisma.$transaction(async (tx) => {
    for (const r of reservations) {
      // 1. Release the reservation
      await tx.stockReservation.update({
        where: { id: r.id },
        data: { status: 'RELEASED' },
      })
      // 2. Decrement inventory.quantityReserved — only if > 0 to avoid
      //    going negative if the counter was already drifted
      const inv = await tx.inventory.findFirst({
        where: { variantId: r.variantId, warehouseId: r.warehouseId },
        select: { id: true, quantityReserved: true },
      })
      if (inv && inv.quantityReserved > 0) {
        const decrementBy = Math.min(r.quantity, inv.quantityReserved)
        await tx.inventory.update({
          where: { id: inv.id },
          data: { quantityReserved: { decrement: decrementBy } },
        })
        console.log(`  ✓ Released reservation ${r.id.slice(0, 8)} and decremented reserved by ${decrementBy}`)
      } else {
        console.log(`  ✓ Released reservation ${r.id.slice(0, 8)} (inventory reserved already at 0 — no decrement)`)
      }
    }
  })

  console.log('\n── AFTER ──\n')
  for (const r of reservations) {
    const fresh = await prisma.stockReservation.findUnique({ where: { id: r.id } })
    console.log(`  reservation ${r.id.slice(0, 8)}  status=${fresh?.status}`)
    const inv = await prisma.inventory.findFirst({
      where: { variantId: r.variantId, warehouseId: r.warehouseId },
      select: { id: true, quantityOnHand: true, quantityReserved: true },
    })
    if (inv) {
      console.log(`  inventory ${inv.id.slice(0, 8)}  onHand=${inv.quantityOnHand}  reserved=${inv.quantityReserved}  available=${inv.quantityOnHand - inv.quantityReserved}`)
    }
  }

  console.log('\n✅ Done — the reservations page should now show 0 active RESERVED rows for this order')
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
