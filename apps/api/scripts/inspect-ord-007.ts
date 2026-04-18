import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const order = await prisma.order.findFirst({
    where: { orderNumber: 'ORD-20260417-000007' },
    include: {
      payment: {
        include: {
          refunds: { orderBy: { createdAt: 'desc' } },
        },
      },
      statusHistory: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!order) { console.log('NOT FOUND'); return }

  console.log('\n═══ ORD-20260417-000007 ═══\n')
  console.log(`  Status:         ${order.status}`)
  console.log(`  Created:        ${order.createdAt.toISOString()}`)
  console.log(`  totalAmount:    €${Number(order.totalAmount).toFixed(2)}`)
  console.log(`  cancelledAt:    ${(order as any).cancelledAt ?? 'null'}`)

  if (order.payment) {
    const p = order.payment
    console.log(`\n  Payment:`)
    console.log(`    id:                    ${p.id}`)
    console.log(`    provider:              ${p.provider}`)
    console.log(`    method:                ${p.method}`)
    console.log(`    status:                ${p.status}`)
    console.log(`    providerPaymentId:     ${p.providerPaymentId}`)
    console.log(`    prevProviderIds:       ${JSON.stringify(p.previousProviderPaymentIds)}`)
    console.log(`    amount:                €${Number(p.amount).toFixed(2)}`)
    console.log(`    paidAt:                ${p.paidAt ?? 'null'}`)
    console.log(`    refundedAt:            ${p.refundedAt ?? 'null'}`)
    console.log(`    refunds count:         ${p.refunds.length}`)
  } else {
    console.log('\n  No Payment row')
  }

  console.log(`\n  Status history (${order.statusHistory.length} entries):`)
  for (const h of order.statusHistory) {
    console.log(`    ${h.createdAt.toISOString().slice(11, 19)}  ${h.fromStatus ?? '—'} → ${h.toStatus}  (${h.source}) notes="${(h.notes ?? '').slice(0, 80)}"`)
  }

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
