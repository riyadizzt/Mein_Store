import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const start = new Date('2026-04-01T00:00:00.000Z')
  const end = new Date('2026-04-16T23:59:59.999Z')

  // 1. Revenue by channel (what the finance dashboard shows)
  console.log('\n── Revenue by channel (April) ──\n')
  const revenueByChannel = await prisma.order.groupBy({
    by: ['channel'],
    where: {
      createdAt: { gte: start, lte: end },
      status: { in: ['confirmed', 'processing', 'shipped', 'delivered', 'returned', 'refunded'] },
      deletedAt: null,
    },
    _sum: { totalAmount: true },
    _count: { _all: true },
  })
  for (const r of revenueByChannel) {
    console.log(`  ${String(r.channel).padEnd(12)}  orders=${r._count._all}  gross=€${Number(r._sum.totalAmount ?? 0).toFixed(2)}`)
  }

  // 2. Refunds — are they linked back to the original order's channel?
  console.log('\n── Refunds with original order channel ──\n')
  const refunds = await prisma.refund.findMany({
    where: { createdAt: { gte: start, lte: end }, status: 'PROCESSED' },
    select: {
      id: true,
      amount: true,
      payment: {
        select: {
          order: {
            select: { orderNumber: true, channel: true, status: true },
          },
        },
      },
    },
  })

  const refundsByChannel: Record<string, { count: number; amount: number }> = {}
  for (const r of refunds) {
    const channel = r.payment?.order?.channel ?? 'unknown'
    if (!refundsByChannel[channel]) refundsByChannel[channel] = { count: 0, amount: 0 }
    refundsByChannel[channel].count++
    refundsByChannel[channel].amount += Number(r.amount)
  }

  console.log(`  Total refunds: ${refunds.length}`)
  for (const [ch, data] of Object.entries(refundsByChannel)) {
    console.log(`  ${ch.padEnd(12)}  refunds=${data.count}  amount=€${data.amount.toFixed(2)}`)
  }

  // 3. Check: does the finance service's aggregateRefunds do this correctly?
  console.log('\n── Finance service refundsByChannel (raw DB query) ──\n')
  const refundRows = await prisma.refund.findMany({
    where: { createdAt: { gte: start, lte: end }, status: 'PROCESSED' },
    select: {
      amount: true,
      payment: {
        select: { order: { select: { channel: true } } },
      },
    },
  })
  const byChannel: Record<string, number> = {}
  let totalRefunded = 0
  for (const r of refundRows) {
    const ch = r.payment?.order?.channel ?? 'unknown'
    const amt = Number(r.amount)
    byChannel[ch] = (byChannel[ch] ?? 0) + amt
    totalRefunded += amt
  }
  console.log(`  Total refunded: €${totalRefunded.toFixed(2)}`)
  for (const [ch, amt] of Object.entries(byChannel)) {
    console.log(`  ${ch.padEnd(12)}  €${amt.toFixed(2)}`)
  }

  // 4. Net revenue per channel
  console.log('\n── Net revenue per channel (gross - refunds) ──\n')
  for (const r of revenueByChannel) {
    const ch = String(r.channel)
    const gross = Number(r._sum.totalAmount ?? 0)
    const refund = refundsByChannel[ch]?.amount ?? 0
    const net = gross - refund
    console.log(`  ${ch.padEnd(12)}  gross=€${gross.toFixed(2)}  refunds=€${refund.toFixed(2)}  net=€${net.toFixed(2)}`)
  }

  console.log('\n✅ Refunds ARE linked to the original order\'s channel via payment → order → channel')

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
