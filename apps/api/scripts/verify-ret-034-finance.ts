/**
 * Verify the finance numbers shown to the admin after RET-2026-00034 was
 * confirmed (Vorkasse manual bank transfer). Read-only.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  console.log('\n═══ RET-2026-00034 (die gerade bestätigte Retoure) ═══\n')
  const ret = await prisma.return.findFirst({
    where: { returnNumber: 'RET-2026-00034' },
    include: {
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          totalAmount: true,
          taxAmount: true,
          createdAt: true,
          payment: {
            select: {
              id: true,
              provider: true,
              status: true,
              amount: true,
              refunds: {
                select: { id: true, amount: true, status: true, processedAt: true, createdAt: true },
                orderBy: { createdAt: 'desc' },
              },
            },
          },
        },
      },
    },
  })
  if (!ret) {
    console.log('  NICHT GEFUNDEN')
    return
  }
  console.log(`  Order:              ${ret.order.orderNumber}  (${ret.order.status})`)
  console.log(`  Order-Betrag brutto: €${Number(ret.order.totalAmount).toFixed(2)}`)
  console.log(`  Retoure-Betrag:      €${Number(ret.refundAmount ?? 0).toFixed(2)}`)
  console.log(`  Payment Provider:    ${ret.order.payment?.provider}`)
  console.log(`  Payment Status:      ${ret.order.payment?.status}`)
  console.log(`  Refund-Rows:`)
  for (const r of ret.order.payment?.refunds ?? []) {
    const ago = Math.round((Date.now() - new Date(r.createdAt).getTime()) / 60000)
    console.log(
      `    ${r.id.slice(0, 8)}  €${Number(r.amount).toFixed(2)}  status=${r.status}  createdAt=${new Date(r.createdAt).toISOString().slice(0, 19)}  (${ago} min ago)`,
    )
    console.log(
      `       processedAt=${r.processedAt ? new Date(r.processedAt).toISOString().slice(0, 19) : 'null'}`,
    )
  }

  console.log('\n═══ Alle Refunds vom 17.04.2026 (status=PROCESSED) — was im Finanzbericht zählt ═══\n')
  const today = new Date()
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0))
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 23, 59, 59, 999))

  const processed = await prisma.refund.findMany({
    where: { status: 'PROCESSED', createdAt: { gte: start, lte: end } },
    include: {
      payment: {
        select: { provider: true, order: { select: { orderNumber: true, channel: true } } },
      },
    },
  })
  let sumToday = 0
  for (const r of processed) {
    const amt = Number(r.amount)
    sumToday += amt
    console.log(
      `  ${r.payment?.order?.orderNumber?.padEnd(22)}  ${r.payment?.provider?.padEnd(10)}  €${amt.toFixed(2)}  ${new Date(r.createdAt).toISOString().slice(11, 16)} UTC`,
    )
  }
  console.log(`\n  Total PROCESSED refunds today: €${sumToday.toFixed(2)}   (${processed.length} refunds)`)

  console.log('\n═══ Monatliche Refund-Summe April 2026 (PROCESSED) — für die Jahres-/Monats-Box ═══\n')
  const apr1 = new Date(Date.UTC(2026, 3, 1, 0, 0, 0))
  const apr30 = new Date(Date.UTC(2026, 3, 30, 23, 59, 59, 999))
  const monthRefunds = await prisma.refund.aggregate({
    where: { status: 'PROCESSED', createdAt: { gte: apr1, lte: apr30 } },
    _sum: { amount: true },
    _count: true,
  })
  console.log(`  April 2026 total refunds (PROCESSED): €${Number(monthRefunds._sum.amount ?? 0).toFixed(2)}  (${monthRefunds._count} refunds)`)

  const monthOrders = await prisma.order.aggregate({
    where: {
      status: { in: ['confirmed', 'processing', 'shipped', 'delivered', 'returned', 'refunded'] as any },
      createdAt: { gte: apr1, lte: apr30 },
      deletedAt: null,
    },
    _sum: { totalAmount: true, taxAmount: true },
    _count: true,
  })
  const gross = Number(monthOrders._sum.totalAmount ?? 0)
  const tax = Number(monthOrders._sum.taxAmount ?? 0)
  const refundsTotal = Number(monthRefunds._sum.amount ?? 0)
  console.log(`  April 2026 total orders gross:  €${gross.toFixed(2)}  (${monthOrders._count} orders)`)
  console.log(`  April 2026 total orders tax:    €${tax.toFixed(2)}`)
  console.log(`  April 2026 orders net (gross-tax):   €${(gross - tax).toFixed(2)}`)
  console.log(`  April 2026 minus refunds:            €${(gross - refundsTotal).toFixed(2)}`)
  console.log(`  April 2026 final net revenue:        €${(gross - tax - refundsTotal).toFixed(2)}`)

  console.log('\n═══ Vorkasse-Refunds noch in PENDING (unsichtbar in Reports) ═══\n')
  const stillPending = await prisma.refund.findMany({
    where: { status: 'PENDING', payment: { provider: 'VORKASSE' } },
    include: { payment: { select: { order: { select: { orderNumber: true } } } } },
    orderBy: { createdAt: 'asc' },
  })
  if (stillPending.length === 0) {
    console.log('  KEINE — alle Vorkasse-Refunds sind bestätigt.')
  } else {
    for (const r of stillPending) {
      console.log(
        `  ${r.payment?.order?.orderNumber?.padEnd(22)}  €${Number(r.amount).toFixed(2)}  created=${new Date(r.createdAt).toISOString().slice(0, 10)}`,
      )
    }
    console.log(`\n  ${stillPending.length} Refunds, Summe: €${stillPending.reduce((s, r) => s + Number(r.amount), 0).toFixed(2)}`)
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
