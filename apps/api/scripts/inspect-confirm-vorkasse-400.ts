import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const UUID = '2d02918f-c86a-4781-9f3b-93109bc218b2'

  // Is it an order id?
  const order = await prisma.order.findUnique({
    where: { id: UUID },
    include: { payment: true },
  })
  console.log(`\nLookup by order.id = ${UUID}`)
  if (order) {
    console.log(`  ✅ Order found: ${order.orderNumber}  status=${order.status}`)
    console.log(`     payment: provider=${order.payment?.provider}  status=${order.payment?.status}`)
    console.log(`     deletedAt: ${order.deletedAt?.toISOString() ?? 'null'}`)
  } else {
    console.log(`  ❌ No order with this id`)
  }

  // Is it a payment id?
  const payment = await prisma.payment.findUnique({
    where: { id: UUID },
    include: { order: { select: { orderNumber: true, status: true, deletedAt: true } } },
  })
  console.log(`\nLookup by payment.id = ${UUID}`)
  if (payment) {
    console.log(`  ✅ Payment found for order ${payment.order?.orderNumber}`)
    console.log(`     payment: provider=${payment.provider}  status=${payment.status}`)
    console.log(`     order status=${payment.order?.status}  deletedAt=${payment.order?.deletedAt?.toISOString() ?? 'null'}`)
  } else {
    console.log(`  ❌ No payment with this id`)
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
