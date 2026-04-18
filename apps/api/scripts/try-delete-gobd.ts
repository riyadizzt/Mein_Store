import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  try {
    const result = await prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: 'GS-' }, grossAmount: { lt: 10 } } })
    console.log('Deleted invoices:', result.count)
  } catch (e: any) {
    console.log('Blocked:', e.message.split('\n')[0].slice(0, 100))
  }
  // Now try the orders
  const orders = await prisma.order.findMany({ where: { orderNumber: { startsWith: 'E2E-CL-' } }, select: { id: true, orderNumber: true } })
  for (const o of orders) {
    try { await prisma.order.delete({ where: { id: o.id } }); console.log(`  ✓ ${o.orderNumber}`) }
    catch (e: any) { console.log(`  ✗ ${o.orderNumber}: ${e.message.split('\n')[0].slice(0, 80)}`) }
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
