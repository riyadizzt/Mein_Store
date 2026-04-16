import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const order = await prisma.order.findFirst({
    where: { orderNumber: 'ORD-20260416-000003' },
    include: {
      payment: { select: { provider: true, status: true } },
      items: { select: { id: true, variantId: true, quantity: true, snapshotName: true } },
      statusHistory: { orderBy: { createdAt: 'asc' }, select: { fromStatus: true, toStatus: true, source: true, createdAt: true } },
    },
  })
  if (!order) { console.log('Order not found'); await prisma.$disconnect(); return }

  console.log(`\n── Order ${order.orderNumber} ──`)
  console.log(`  status: ${order.status}`)
  console.log(`  payment: ${order.payment?.provider} / ${order.payment?.status}`)
  console.log(`  items: ${order.items.length}`)
  for (const it of order.items) {
    console.log(`    ${it.snapshotName}  variantId=${it.variantId?.slice(0, 8)}  qty=${it.quantity}`)
  }

  console.log(`\n── Status History ──`)
  for (const h of order.statusHistory) {
    console.log(`  ${h.createdAt.toISOString()}  ${h.fromStatus ?? '∅'} → ${h.toStatus}  (${h.source})`)
  }

  // Check inventory movements for this order's variants
  console.log(`\n── Inventory Movements (released) for these variants ──`)
  const variantIds = order.items.map((i) => i.variantId).filter(Boolean) as string[]

  // Find movements with type 'released' around the order time
  const movements = await prisma.inventoryMovement.findMany({
    where: {
      variantId: { in: variantIds },
      type: 'released',
      createdAt: { gte: new Date(order.createdAt.getTime() - 60000), lte: new Date(order.createdAt.getTime() + 600000) },
    },
    include: {
      warehouse: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`  Found ${movements.length} 'released' movements within 10min of order:`)
  for (const m of movements) {
    console.log(`    ${m.createdAt.toISOString()}  ${m.variantId.slice(0, 8)}  qty=${m.quantity}  ${m.warehouse?.name}  type=${m.type}`)
  }

  // Also check ALL movements for these variants today
  const today = new Date()
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0)
  const dayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59)

  const allMovements = await prisma.inventoryMovement.findMany({
    where: {
      variantId: { in: variantIds },
      createdAt: { gte: dayStart, lte: dayEnd },
    },
    include: { warehouse: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`\n── ALL movements today for these variants ──`)
  console.log(`  Found ${allMovements.length} movements:`)
  const byType = new Map<string, number>()
  for (const m of allMovements) {
    byType.set(m.type, (byType.get(m.type) ?? 0) + 1)
    console.log(`    ${m.createdAt.toISOString().slice(11, 19)}  ${m.variantId.slice(0, 8)}  ${m.type.padEnd(12)}  qty=${String(m.quantity).padStart(3)}  ${m.warehouse?.name}`)
  }
  console.log(`\n  Summary: ${[...byType.entries()].map(([t, c]) => `${t}=${c}`).join(', ')}`)

  // Check current inventory
  console.log(`\n── Current inventory for these variants ──`)
  for (const vid of variantIds) {
    const invs = await prisma.inventory.findMany({
      where: { variantId: vid },
      include: { warehouse: { select: { name: true } }, variant: { select: { sku: true } } },
    })
    for (const inv of invs) {
      console.log(`  ${inv.variant.sku}  ${inv.warehouse.name.padEnd(20)}  onHand=${inv.quantityOnHand}  reserved=${inv.quantityReserved}  available=${inv.quantityOnHand - inv.quantityReserved}`)
    }
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
