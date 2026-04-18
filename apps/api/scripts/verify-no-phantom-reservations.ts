/**
 * Drift-verification script — reusable version of the Phase-1 diagnostic
 * from the 18.04 audit. Scans all orders in post-pending states for
 * CONFIRMED reservations whose warehouseId does not match the last
 * sale_online movement's warehouseId for the same (order, variant).
 *
 * Reports each drift with reservation-id + order-id + warehouses so the
 * admin can decide whether a targeted cleanup (like
 * cleanup-phantom-reservation-ord000001.ts) is needed.
 *
 * Read-only. Exit code 1 if drift found, 0 if clean. Safe to run from CI
 * as a periodic health check.
 */

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config()
} catch { /* noop */ }

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main() {
  const ws = await p.warehouse.findMany({ select: { id: true, name: true } })
  const whMap = Object.fromEntries(ws.map((w: any) => [w.id, w.name]))

  const CUTOFF = ['confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned', 'refunded', 'disputed']
  const openOrders = await p.order.findMany({
    where: { status: { in: CUTOFF }, deletedAt: null },
    select: { id: true, orderNumber: true, status: true },
  })
  const orderMap = new Map(openOrders.map((o: any) => [o.id, o]))

  const candidates = await p.stockReservation.findMany({
    where: { status: 'CONFIRMED', orderId: { in: openOrders.map((o: any) => o.id) } },
    include: { variant: { select: { sku: true, color: true, size: true } } },
  })

  const drifts: any[] = []
  for (const r of candidates) {
    const sale = await p.inventoryMovement.findFirst({
      where: { variantId: r.variantId, type: 'sale_online', notes: { contains: r.id } },
      select: { warehouseId: true },
    })
    if (sale && sale.warehouseId !== r.warehouseId) {
      const o: any = orderMap.get(r.orderId ?? '')
      drifts.push({
        reservationId: r.id,
        orderId: r.orderId,
        orderNumber: o?.orderNumber ?? '?',
        orderStatus: o?.status ?? '?',
        sku: r.variant.sku,
        color: r.variant.color ?? '-',
        size: r.variant.size ?? '-',
        qty: r.quantity,
        resWh: whMap[r.warehouseId] ?? r.warehouseId,
        saleWh: whMap[sale.warehouseId] ?? sale.warehouseId,
      })
    }
  }

  console.log(`\nReservations scanned: ${candidates.length}`)
  console.log(`Phantom drifts:       ${drifts.length}\n`)
  if (drifts.length === 0) {
    console.log('✓ No phantom reservations detected.')
    process.exit(0)
  }
  for (const d of drifts) {
    console.log(`  ⚠ ${d.orderNumber} [${d.orderStatus}] ${d.sku} ${d.color}/${d.size} qty=${d.qty}`)
    console.log(`    reservation at: ${d.resWh}`)
    console.log(`    sale_online at: ${d.saleWh}`)
    console.log(`    reservation.id=${d.reservationId}`)
    console.log()
  }
  process.exit(1)
}

main()
  .catch((e) => { console.error('ERROR:', e); process.exit(1) })
  .finally(() => p.$disconnect())
