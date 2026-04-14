import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const orders = await prisma.order.findMany({
    where: { orderNumber: { in: ['ORD-20260414-000006','ORD-20260414-000007','ORD-20260414-000008','ORD-20260414-000009','ORD-20260414-000010'] } },
    include: {
      items: { select: { variantId: true, quantity: true, unitPrice: true } },
      payment: true,
      user: { select: { id: true, email: true, firstName: true, lastName: true, passwordHash: true, isVerified: true, createdAt: true } },
    },
    orderBy: { orderNumber: 'asc' },
  })
  for (const o of orders) {
    console.log('\n══════════════════════════════════════════════')
    console.log(`${o.orderNumber}  [status=${o.status}]  created=${o.createdAt.toISOString()}`)
    console.log(`  totalAmount=${o.totalAmount}  currency=${o.currency}  channel=${o.channel}`)
    console.log(`  guestEmail=${JSON.stringify(o.guestEmail)}  userId=${JSON.stringify(o.userId)}`)
    if (o.user) {
      console.log(`  user: email=${o.user.email}  name=${o.user.firstName} ${o.user.lastName}  pw=${o.user.passwordHash ? 'set' : 'null'}  verified=${o.user.isVerified}  created=${o.user.createdAt.toISOString()}`)
    } else {
      console.log(`  user: NULL (no linked user)`)
    }
    console.log(`  shippingAddressId=${o.shippingAddressId?.slice(0,8) ?? 'null'}  snapshot=${o.shippingAddressSnapshot ? 'yes' : 'no'}`)
    console.log(`  couponCode=${o.couponCode ?? 'null'}  discountAmount=${o.discountAmount}`)
    console.log(`  cancelledAt=${o.cancelledAt?.toISOString() ?? 'null'}  cancelReason=${o.cancelReason ?? 'null'}`)
    console.log(`  items (${o.items.length}): ${o.items.map((i: any) => `${i.variantId.slice(0,6)}x${i.quantity}@${i.unitPrice}`).join(' | ')}`)
    if (o.payment) {
      const p = o.payment
      console.log(`  payment: ${p.provider}/${p.status}  providerPaymentId=${p.providerPaymentId?.slice(0,25) ?? 'null'}`)
      console.log(`    prev=[${p.previousProviderPaymentIds?.map((x: string)=>x.slice(0,18)).join(', ') ?? ''}]`)
      console.log(`    created=${p.createdAt.toISOString()}  updated=${p.updatedAt.toISOString()}`)
      console.log(`    amount=${p.amount}  refundedAmount=${p.refundedAmount}`)
    } else {
      console.log(`  payment: NONE`)
    }
    if (o.notes) console.log(`  notes=${String(o.notes).slice(0,300)}`)
    if (o.shippingAddressSnapshot) {
      const snap = o.shippingAddressSnapshot as any
      console.log(`  snapshot: email=${snap.email ?? 'NO EMAIL'}  name=${snap.firstName ?? ''} ${snap.lastName ?? ''}  city=${snap.city ?? ''}  plz=${snap.postalCode ?? ''}`)
    }
  }
  console.log('\n── Cross-check: same cart items? ──')
  const cartHashes = orders.map(o => ({
    nr: o.orderNumber,
    cart: o.items.map(i => `${i.variantId}:${i.quantity}`).sort().join('|'),
    total: o.totalAmount.toString(),
    email: o.guestEmail,
    userId: o.userId,
  }))
  for (const ch of cartHashes) console.log(`  ${ch.nr}: total=${ch.total} userId=${ch.userId?.slice(0,8)} email=${ch.email} cart=${ch.cart.slice(0,60)}`)

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
