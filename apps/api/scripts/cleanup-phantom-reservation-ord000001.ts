/**
 * One-shot cleanup for the R7 post-capture phantom reservation on
 * ORD-20260418-000001. Already executed on 2026-04-18 19:59 UTC; this file
 * is kept for the git history so the operation is auditable + reproducible
 * logic-wise if a similar edge case ever surfaces again.
 *
 * Context:
 *   The consolidate-warehouse flow (R7, Gruppe 2) moved a reservation row
 *   from Marzahn → Pannierstr Shop at 17:51, AFTER sale_online had already
 *   decremented Marzahn's onHand at 17:42. Effect: Pannierstr Shop held a
 *   ghost `quantityReserved=2` for an order that had already shipped +
 *   been partially returned. No real order-in-flight needed those units.
 *
 *   Commit a5e50b9 (Commit 1) blocks this from happening again by
 *   refusing consolidate/change_item for any order status outside
 *   {pending, pending_payment}. The phantom from before that fix is
 *   cleaned here in a single atomic transaction.
 *
 * Idempotency:
 *   The script pre-checks the phantom's exact shape (reservation status,
 *   warehouse, quantity). If anything differs (already cleaned, already
 *   RELEASED, quantity changed, etc.) it aborts without writes.
 *
 * Audit trail:
 *   Writes a PHANTOM_RESERVATION_CLEANED row to adminAuditLog with full
 *   provenance (reservationId, originalWarehouseId, variantId, qty,
 *   cleanupReason referencing the commit chain that produced the fix).
 */

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config()
} catch { /* noop */ }

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

// ── Fixture constants identified in Phase-1 inspection ─────────
const RESERVATION_ID = '9ce39290-bb65-48a5-a531-41e3db377561'
const INVENTORY_ID   = '741fe592-9953-4a0d-9df5-22f7f179ae31'
const ORDER_ID       = '5b779088-5396-4060-9923-b8d15bba8e0b'
const VARIANT_ID     = '74d8a45e-5b8e-430c-990f-d35bab5b8fbf'
const WAREHOUSE_ID   = 'e3d69c32-b991-4c44-9cbf-22785e4cc472'  // Pannierstr Shop (the ghost location)
const QTY            = 2
const ADMIN_ID       = 'phantom-cleanup-script'
const CLEANUP_REASON =
  'Bug-#2 R7 post-capture phantom from ORD-20260418-000001 — ' +
  'refs: a5e50b9 (guard) + 2c72b19 (frontend) + a96aa4f (tests)'

async function main() {
  // ── Pre-check: defend against re-running after someone already cleaned
  const pre = await p.stockReservation.findUnique({ where: { id: RESERVATION_ID } })
  if (!pre) {
    console.log('✓ Phantom reservation no longer exists — already cleaned. No-op.')
    return
  }
  if (pre.status !== 'CONFIRMED') {
    console.log(`✓ Reservation status=${pre.status} (not CONFIRMED) — already cleaned. No-op.`)
    return
  }
  if (pre.warehouseId !== WAREHOUSE_ID || pre.quantity !== QTY) {
    throw new Error(
      `Shape drift: warehouseId=${pre.warehouseId} qty=${pre.quantity} — aborting for safety`,
    )
  }
  const preInv = await p.inventory.findUnique({ where: { id: INVENTORY_ID } })
  if (!preInv) throw new Error('Inventory row missing — aborting')
  if (preInv.quantityReserved < QTY) {
    throw new Error(
      `Inventory reserved=${preInv.quantityReserved} < ${QTY} — aborting to avoid negative`,
    )
  }
  const onHandSnapshot = preInv.quantityOnHand

  console.log('Pre-check passed. Executing atomic transaction...')

  // ── Atomic cleanup — all-or-nothing ─────────────────────────
  await p.$transaction([
    p.stockReservation.update({
      where: { id: RESERVATION_ID },
      data: { status: 'RELEASED' },
    }),
    p.inventory.update({
      where: { id: INVENTORY_ID },
      data: { quantityReserved: { decrement: QTY } },
    }),
    p.inventoryMovement.create({
      data: {
        variantId: VARIANT_ID,
        warehouseId: WAREHOUSE_ID,
        type: 'released',
        quantity: QTY,
        quantityBefore: onHandSnapshot,
        quantityAfter: onHandSnapshot,
        notes: 'Cleanup Phantom R7 post-capture from ORD-20260418-000001',
      },
    }),
    p.adminAuditLog.create({
      data: {
        adminId: ADMIN_ID,
        action: 'PHANTOM_RESERVATION_CLEANED',
        entityType: 'order',
        entityId: ORDER_ID,
        changes: {
          after: {
            reservationId: RESERVATION_ID,
            originalWarehouseId: WAREHOUSE_ID,
            variantId: VARIANT_ID,
            qty: QTY,
            cleanupReason: CLEANUP_REASON,
          },
        },
        ipAddress: '127.0.0.1',
      },
    }),
  ])
  console.log('  ✓ tx committed (4 ops)')

  // ── Post-verification: run Phase-1 drift query again ────────
  const CUTOFF = ['confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned', 'refunded', 'disputed']
  const openOrders = await p.order.findMany({
    where: { status: { in: CUTOFF }, deletedAt: null },
    select: { id: true },
  })
  const candidates = await p.stockReservation.findMany({
    where: { status: 'CONFIRMED', orderId: { in: openOrders.map((o: any) => o.id) } },
    select: { id: true, variantId: true, warehouseId: true, orderId: true },
  })
  let drifts = 0
  for (const r of candidates) {
    const sale = await p.inventoryMovement.findFirst({
      where: { variantId: r.variantId, type: 'sale_online', notes: { contains: r.id } },
      select: { warehouseId: true },
    })
    if (sale && sale.warehouseId !== r.warehouseId) drifts++
  }
  console.log(`\n═══ Post-Cleanup Drift: ${drifts} / ${candidates.length} ═══`)
  if (drifts !== 0) {
    console.log('⚠ DRIFT STILL PRESENT — investigate before relying on this cleanup')
    process.exit(1)
  }

  const postRes = await p.stockReservation.findUnique({
    where: { id: RESERVATION_ID },
    select: { status: true },
  })
  const postInv = await p.inventory.findUnique({
    where: { id: INVENTORY_ID },
    select: { quantityOnHand: true, quantityReserved: true },
  })
  console.log(`  reservation.status = ${postRes?.status}`)
  console.log(`  inventory: onHand=${postInv?.quantityOnHand} reserved=${postInv?.quantityReserved}`)
  console.log('\n✓ Cleanup verified — system clean')
}

main()
  .catch((e) => { console.error('ERROR:', e); process.exit(1) })
  .finally(() => p.$disconnect())
