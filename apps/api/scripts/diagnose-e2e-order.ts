import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const order = await prisma.order.findFirst({ where: { orderNumber: 'E2E-CL-1776460098059-3816' } })
  if (!order) { console.log('not found'); return }
  console.log('Order:', order.id, order.status, 'total', Number(order.totalAmount))
  const invoices = await prisma.invoice.findMany({ where: { orderId: order.id } })
  console.log('Invoices:', invoices.length, invoices.map(i => ({ id: i.id, number: i.invoiceNumber })))
  const payments = await prisma.payment.findMany({ where: { orderId: order.id } })
  console.log('Payments:', payments.length)
  const refunds = await prisma.refund.findMany({ where: { payment: { orderId: order.id } } })
  console.log('Refunds:', refunds.length)
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
