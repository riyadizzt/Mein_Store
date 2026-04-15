/**
 * Read-only trace of what happened inventory-wise to 2 specific orders.
 * Helps distinguish "reservation never confirmed" from "reservation never
 * even created in the first place".
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const shortIds = ['4d849f1d', 'a4c20e42']
  for (const short of shortIds) {
    const order = await prisma.order.findFirst({
      where: { id: { startsWith: short } },
      select: { id: true, orderNumber: true },
    })
    if (!order) { console.log(`${short}: not found`); continue }

    console.log(`\n══ ${order.orderNumber} (id=${order.id}) ══\n`)

    // 1. StockReservation rows with this orderId
    const reservations = await prisma.stockReservation.findMany({
      where: { orderId: order.id },
      select: { id: true, status: true, quantity: true, createdAt: true, expiresAt: true, variantId: true, warehouseId: true },
      orderBy: { createdAt: 'asc' },
    })
    console.log(`StockReservation rows: ${reservations.length}`)
    for (const r of reservations) {
      console.log(`  id=${r.id.slice(0, 8)}  status=${r.status.padEnd(10)}  qty=${r.quantity}  variant=${r.variantId.slice(0, 8)}`)
    }

    // 2. InventoryMovement rows referencing this order or its reservations
    const resIds = reservations.map((r) => r.id)
    const movements = await prisma.inventoryMovement.findMany({
      where: {
        OR: [
          { referenceId: order.id },
          ...(resIds.length ? [{ referenceId: { in: resIds } }] : []),
        ],
      },
      select: { id: true, type: true, quantity: true, referenceId: true, notes: true, createdAt: true, variantId: true },
      orderBy: { createdAt: 'asc' },
    })
    console.log(`\nInventoryMovement rows: ${movements.length}`)
    for (const m of movements) {
      const refShort = m.referenceId?.slice(0, 8) ?? '(none)'
      console.log(`  ${m.createdAt.toISOString().slice(11, 19)}  ${m.type.padEnd(20)}  qty=${String(m.quantity).padStart(4)}  ref=${refShort}  ${m.notes ?? ''}`)
    }

    // 3. OrderItems — which variants/quantities are we talking about
    const items = await prisma.orderItem.findMany({
      where: { orderId: order.id },
      select: { variantId: true, quantity: true, snapshotSku: true },
    })
    console.log(`\nOrderItems:`)
    for (const it of items) {
      console.log(`  ${it.snapshotSku.padEnd(25)}  qty=${it.quantity}  variant=${it.variantId.slice(0, 8)}`)
    }
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
