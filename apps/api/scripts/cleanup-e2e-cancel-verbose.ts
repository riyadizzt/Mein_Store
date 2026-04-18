import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const orphans = await prisma.order.findMany({
    where: { orderNumber: { startsWith: 'E2E-CL-' } },
    select: { id: true, orderNumber: true },
  })
  for (const o of orphans) {
    // Nuke everything that has an FK → order
    const tablesToClean = [
      'invoice', 'payment', 'orderStatusHistory', 'orderItem',
      'shipment', 'return', 'couponUsage', 'stockReservation',
    ]
    for (const table of tablesToClean) {
      await (prisma as any)[table].deleteMany({ where: { orderId: o.id } }).catch(() => {})
    }
    try {
      await prisma.order.delete({ where: { id: o.id } })
      console.log(`  ✓ deleted ${o.orderNumber}`)
    } catch (e: any) {
      console.log(`  ✗ ${o.orderNumber}: ${e.message.split('\n')[0]}`)
    }
  }
  console.log('\n  final count:', await prisma.order.count({ where: { orderNumber: { startsWith: 'E2E-CL-' } } }))
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
