import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const order = await prisma.order.findFirst({
    where: { orderNumber: 'ORD-20260415-000006' },
    include: {
      payment: true,
      items: { select: { id: true, variantId: true, quantity: true } },
      statusHistory: { orderBy: { createdAt: 'asc' }, select: { fromStatus: true, toStatus: true, source: true, createdAt: true, notes: true } },
      shipment: { select: { id: true, status: true, createdAt: true, updatedAt: true } },
    },
  })

  if (!order) { console.log('Not found'); return }

  console.log('\n── Order ORD-20260415-000006 ──\n')
  console.log('  id:            ', order.id)
  console.log('  status:        ', order.status)
  console.log('  createdAt:     ', order.createdAt.toISOString())
  console.log('  updatedAt:     ', order.updatedAt.toISOString())
  console.log('  cancelledAt:   ', order.cancelledAt?.toISOString() ?? 'null')
  console.log('')
  console.log('  Payment:       ', order.payment?.provider, order.payment?.status)
  console.log('  Payment paidAt:', order.payment?.paidAt?.toISOString() ?? 'null')
  console.log('  Shipment:      ', order.shipment?.status ?? 'none')
  if (order.shipment) console.log('  Shipment upd:  ', order.shipment.updatedAt.toISOString())
  console.log('')
  console.log('  Items:')
  for (const it of order.items) {
    console.log(`    ${it.id.slice(0,8)}  variantId=${it.variantId?.slice(0,8) ?? 'null'}  qty=${it.quantity}`)
  }
  console.log('')
  console.log('  Status history:')
  for (const h of order.statusHistory) {
    console.log(`    ${h.createdAt.toISOString()}  ${h.fromStatus ?? '∅'} → ${h.toStatus}  (${h.source ?? '∅'})`)
    if (h.notes) console.log(`       note: ${h.notes}`)
  }

  console.log('\n── StockReservations for this order ──\n')
  const reservations = await prisma.stockReservation.findMany({
    where: { orderId: order.id },
    include: { variant: { select: { sku: true } }, warehouse: { select: { name: true } } },
  })
  for (const r of reservations) {
    console.log(`  ${r.id.slice(0,8)}  ${r.variant.sku.padEnd(20)}  ${r.quantity}x  ${r.status}  ${r.warehouse.name}`)
    console.log(`    created:   ${r.createdAt.toISOString()}`)
    console.log(`    updated:   ${r.updatedAt.toISOString()}`)
    console.log(`    expires:   ${r.expiresAt.toISOString()}`)
  }

  // Cross-check: the inventory row — is the reserved count actually
  // polluted by this phantom reservation?
  console.log('\n── Inventory impact ──\n')
  for (const r of reservations) {
    const inv = await prisma.inventory.findFirst({
      where: { variantId: r.variantId, warehouseId: r.warehouseId },
      select: { quantityOnHand: true, quantityReserved: true, updatedAt: true },
    })
    if (inv) {
      const available = inv.quantityOnHand - inv.quantityReserved
      console.log(`  variant=${r.variantId.slice(0,8)} wh=${r.warehouseId.slice(0,8)}`)
      console.log(`    onHand=${inv.quantityOnHand}  reserved=${inv.quantityReserved}  available=${available}`)
      console.log(`    inv updatedAt: ${inv.updatedAt.toISOString()}`)
    }
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
