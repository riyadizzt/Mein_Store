import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const order: any = await prisma.order.findFirst({
    where: { orderNumber: 'ORD-20260413-000022' },
    include: { items: true, payment: true, shippingAddress: true, statusHistory: true },
  })
  if (!order) {
    console.log('Order not found')
    return
  }
  console.log('─── ORD-20260413-000022 ───')
  console.log('id         ', order.id)
  console.log('status     ', order.status)
  console.log('total      ', order.totalAmount)
  console.log('userId     ', order.userId ?? '(guest)')
  console.log('guestEmail ', order.guestEmail ?? '—')
  console.log('createdAt  ', order.createdAt.toISOString())
  console.log('updatedAt  ', order.updatedAt.toISOString())
  if (order.payment) {
    console.log('\n── Payment ──')
    console.log('  provider    ', order.payment.provider)
    console.log('  method      ', order.payment.method)
    console.log('  status      ', order.payment.status)
    console.log('  amount      ', order.payment.amount)
    console.log('  providerPaymentId       ', order.payment.providerPaymentId)
    console.log('  providerClientSecret    ', order.payment.providerClientSecret?.slice(0, 40) + '...')
    console.log('  previousProviderPaymentIds ', JSON.stringify(order.payment.previousProviderPaymentIds ?? []))
    console.log('  failureReason           ', order.payment.failureReason ?? '—')
    console.log('  createdAt               ', order.payment.createdAt.toISOString())
    console.log('  updatedAt               ', order.payment.updatedAt.toISOString())
  }
  console.log('\n── Status History ──')
  for (const h of order.statusHistory) {
    console.log(`  ${h.createdAt.toISOString()}  ${h.fromStatus ?? '—'} → ${h.toStatus}  source=${h.source}  notes=${h.notes ?? ''}`)
  }
}

main().finally(() => prisma.$disconnect())
