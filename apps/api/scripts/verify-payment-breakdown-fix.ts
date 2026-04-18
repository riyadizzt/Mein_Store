/**
 * Verify the payment-method breakdown now includes refunded payments.
 * Read-only against live DB. Emulates the exact query in
 * finance-reports.service.ts:getPaymentBreakdownForDay.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const start = new Date(Date.UTC(2026, 3, 17, 0, 0, 0))
  const end = new Date(Date.UTC(2026, 3, 17, 23, 59, 59, 999))

  const ORDER_STATUSES_COUNTABLE = ['confirmed', 'processing', 'shipped', 'delivered', 'returned', 'refunded']

  console.log('\n═══ VORHER (alte Logik: nur status=captured) ═══')
  const before = await prisma.payment.groupBy({
    by: ['method'],
    where: {
      status: 'captured',
      order: {
        status: { in: ORDER_STATUSES_COUNTABLE as any },
        deletedAt: null,
        createdAt: { gte: start, lte: end },
      },
    },
    _sum: { amount: true },
    _count: true,
  })
  for (const r of before) {
    console.log(`  ${r.method.padEnd(15)} €${Number(r._sum.amount ?? 0).toFixed(2)}  (${r._count} payments)`)
  }
  const beforeTotal = before.reduce((s, r) => s + Number(r._sum.amount ?? 0), 0)
  console.log(`  TOTAL: €${beforeTotal.toFixed(2)} / ${before.reduce((s, r) => s + r._count, 0)} payments`)

  console.log('\n═══ NACHHER (neue Logik: captured + partially_refunded + refunded) ═══')
  const after = await prisma.payment.groupBy({
    by: ['method'],
    where: {
      status: { in: ['captured', 'partially_refunded', 'refunded'] as any },
      order: {
        status: { in: ORDER_STATUSES_COUNTABLE as any },
        deletedAt: null,
        createdAt: { gte: start, lte: end },
      },
    },
    _sum: { amount: true },
    _count: true,
  })
  for (const r of after) {
    console.log(`  ${r.method.padEnd(15)} €${Number(r._sum.amount ?? 0).toFixed(2)}  (${r._count} payments)`)
  }
  const afterTotal = after.reduce((s, r) => s + Number(r._sum.amount ?? 0), 0)
  console.log(`  TOTAL: €${afterTotal.toFixed(2)} / ${after.reduce((s, r) => s + r._count, 0)} payments`)

  console.log('\n═══ Daily-Report Gesamt-Brutto zum Abgleich ═══')
  const total = await prisma.order.aggregate({
    where: {
      status: { in: ORDER_STATUSES_COUNTABLE as any },
      deletedAt: null,
      createdAt: { gte: start, lte: end },
    },
    _sum: { totalAmount: true },
    _count: true,
  })
  console.log(`  Orders am 17.04: ${total._count} Bestellungen, Brutto €${Number(total._sum.totalAmount ?? 0).toFixed(2)}`)
  console.log(`  Payment-Breakdown (neu) Summe: €${afterTotal.toFixed(2)}`)
  console.log(
    `  Match: ${Math.abs(afterTotal - Number(total._sum.totalAmount ?? 0)) < 0.01 ? '✓ Gesamt stimmt überein' : '✗ Divergenz!'}`,
  )

  await prisma.$disconnect()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
