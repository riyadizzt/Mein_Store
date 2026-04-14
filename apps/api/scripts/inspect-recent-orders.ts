import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }, // last hour
    },
    include: {
      items: { select: { variantId: true, quantity: true, unitPrice: true } },
      payment: { select: { provider: true, status: true, amount: true, providerPaymentId: true, createdAt: true } },
      user: { select: { email: true, firstName: true, lastName: true, passwordHash: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  console.log(`Found ${orders.length} orders in the last hour`)
  for (const o of orders) {
    console.log('\n══════════════════════════════════════════════')
    console.log(`${o.orderNumber}  [status=${o.status}]  ${o.createdAt.toISOString()}`)
    console.log(`  subtotal=${o.subtotal}  shippingCost=${o.shippingCost}  discountAmount=${o.discountAmount}  totalAmount=${o.totalAmount}`)
    console.log(`  taxAmount=${o.taxAmount}  currency=${o.currency}  channel=${o.channel}`)
    console.log(`  userId=${o.userId?.slice(0,8) ?? 'null'}  guestEmail=${o.guestEmail}  user=${o.user?.email}`)
    console.log(`  items (${o.items.length}): ${o.items.map((i: any) => `${i.variantId.slice(0,6)}x${i.quantity}@${i.unitPrice}`).join(' | ')}`)
    if (o.payment) {
      console.log(`  payment: ${o.payment.provider}/${o.payment.status}  amount=${o.payment.amount}  providerPaymentId=${o.payment.providerPaymentId?.slice(0,30)}  created=${o.payment.createdAt.toISOString()}`)
      const paymentAmt = Number(o.payment.amount)
      const orderAmt = Number(o.totalAmount)
      if (Math.abs(paymentAmt - orderAmt) > 0.01) {
        console.log(`  ⚠️ MISMATCH: payment.amount=${paymentAmt} but order.totalAmount=${orderAmt} — diff=${(orderAmt - paymentAmt).toFixed(2)}`)
      }
    } else {
      console.log(`  payment: NONE`)
    }
    // Check math: subtotal + shipping - discount = total
    const expectedTotal = Number(o.subtotal) + Number(o.shippingCost) - Number(o.discountAmount)
    if (Math.abs(Number(o.totalAmount) - expectedTotal) > 0.01) {
      console.log(`  ⚠️ MATH: subtotal+ship-disc=${expectedTotal.toFixed(2)} but totalAmount=${o.totalAmount} — diff=${(Number(o.totalAmount) - expectedTotal).toFixed(2)}`)
    }
  }

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
