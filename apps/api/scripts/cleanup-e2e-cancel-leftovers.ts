import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const orphans = await prisma.order.findMany({
    where: { orderNumber: { startsWith: 'E2E-CL-' } },
    select: { id: true, orderNumber: true },
  })
  console.log(`  Found ${orphans.length} E2E-CL-* orphan orders`)
  for (const o of orphans) {
    await prisma.invoice.deleteMany({ where: { orderId: o.id } }).catch(() => {})
    await prisma.payment.deleteMany({ where: { orderId: o.id } }).catch(() => {})
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: o.id } }).catch(() => {})
    await prisma.orderItem.deleteMany({ where: { orderId: o.id } }).catch(() => {})
    await prisma.order.delete({ where: { id: o.id } }).catch((e) => {
      console.log(`  ⚠ could not delete ${o.orderNumber}: ${e.message.slice(0, 80)}`)
    })
  }
  console.log(`  ✓ cleanup done`)
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
