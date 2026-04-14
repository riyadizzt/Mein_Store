import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const orders: any[] = await prisma.order.findMany({
    where: { orderNumber: { in: ['ORD-20260413-000016', 'ORD-20260413-000017'] } },
    include: {
      items: true,
      payment: true,
      shippingAddress: true,
    },
    orderBy: { orderNumber: 'asc' },
  })

  for (const o of orders) {
    console.log('\n═══════════════════════════════════════════════════════════')
    console.log(`  ${o.orderNumber}`)
    console.log('═══════════════════════════════════════════════════════════')
    console.log(`  id          = ${o.id}`)
    console.log(`  status      = ${o.status}`)
    console.log(`  userId      = ${o.userId ?? '(guest)'}`)
    console.log(`  guestEmail  = ${o.guestEmail ?? 'n/a'}`)
    console.log(`  createdAt   = ${o.createdAt.toISOString()}`)
    console.log(`  subtotal    = €${Number(o.subtotal).toFixed(2)}`)
    console.log(`  shipping    = €${Number(o.shippingCost).toFixed(2)}`)
    console.log(`  discount    = €${Number(o.discountAmount ?? 0).toFixed(2)}`)
    console.log(`  totalAmount = €${Number(o.totalAmount).toFixed(2)}`)
    console.log(`  couponCode  = ${o.couponCode ?? '(none)'}`)
    console.log(`  Items:`)
    for (const it of o.items) {
      const name = it.productName ?? it.name ?? it.title ?? '(unknown)'
      const unit = it.unitPrice ?? it.price ?? 0
      console.log(`    - ${name} × ${it.quantity}  (variantId=${it.variantId?.slice(0, 8)}, unit=€${Number(unit).toFixed(2)})`)
    }
    if (o.payment) {
      console.log(`  Payment:`)
      console.log(`    status     = ${o.payment.status}`)
      console.log(`    provider   = ${o.payment.provider}`)
      console.log(`    method     = ${o.payment.method}`)
      console.log(`    providerPaymentId       = ${o.payment.providerPaymentId}`)
      console.log(`    previousProviderPaymentIds = ${JSON.stringify((o.payment as any).previousProviderPaymentIds ?? [])}`)
    } else {
      console.log(`  Payment: (none)`)
    }
  }
}

main().finally(() => prisma.$disconnect())
