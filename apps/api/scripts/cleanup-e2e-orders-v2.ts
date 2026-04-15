import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  // Find orphan orders from the e2e test: they reference products that no
  // longer exist. Query via orderItem → variantId IS NULL (not possible) so
  // use a different strategy: find orders with an invoice but no live items.
  const orphans = await prisma.order.findMany({
    where: {
      OR: [
        { orderNumber: 'ORD-20260415-000010' },
        { orderNumber: 'ORD-20260415-000011' },
      ],
    },
    select: { id: true, orderNumber: true },
  })
  console.log(`Found ${orphans.length} e2e orphans`)
  for (const o of orphans) {
    try {
      await prisma.invoice.deleteMany({ where: { orderId: o.id } })
      await prisma.payment.deleteMany({ where: { orderId: o.id } })
      await prisma.stockReservation.deleteMany({ where: { orderId: o.id } })
      await prisma.inventoryMovement.deleteMany({ where: { referenceId: o.id } })
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: o.id } })
      await prisma.orderItem.deleteMany({ where: { orderId: o.id } })
      await prisma.order.delete({ where: { id: o.id } })
      console.log(`  ✓ ${o.orderNumber}`)
    } catch (e: any) {
      console.error(`  ✗ ${o.orderNumber}: ${e.message}`)
    }
  }
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
