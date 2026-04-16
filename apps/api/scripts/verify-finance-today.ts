import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0)
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999)

  // All orders today (any status)
  const allOrders = await prisma.order.findMany({
    where: { createdAt: { gte: start, lte: end }, deletedAt: null },
    select: { orderNumber: true, status: true, totalAmount: true, subtotal: true, shippingCost: true, discountAmount: true, taxAmount: true, couponCode: true, channel: true },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`\n── Alle Bestellungen heute (${start.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}) ──\n`)
  let totalGross = 0
  let countable = 0
  const countableStatuses = ['confirmed', 'processing', 'shipped', 'delivered', 'returned']

  for (const o of allOrders) {
    const gross = Number(o.totalAmount)
    const isCounted = countableStatuses.includes(o.status) && ['website', 'mobile'].includes(o.channel)
    if (isCounted) { totalGross += gross; countable++ }
    console.log(`  ${o.orderNumber}  ${o.status.padEnd(12)}  €${gross.toFixed(2).padStart(8)}  discount=€${Number(o.discountAmount).toFixed(2)}  coupon=${o.couponCode ?? '-'}  ${isCounted ? '✅ counted' : '⛔ excluded'}`)
  }

  // Refunds today
  const refunds = await prisma.refund.findMany({
    where: { createdAt: { gte: start, lte: end }, status: 'PROCESSED' },
    select: { amount: true },
  })
  const totalRefunded = refunds.reduce((s, r) => s + Number(r.amount), 0)

  console.log(`\n── Zusammenfassung ──\n`)
  console.log(`  Bestellungen total:    ${allOrders.length}`)
  console.log(`  Davon zählbar:         ${countable}`)
  console.log(`  Brutto-Umsatz:         €${totalGross.toFixed(2)}`)
  console.log(`  Erstattungen:          €${totalRefunded.toFixed(2)}`)
  console.log(`  Netto:                 €${(totalGross - totalRefunded).toFixed(2)}`)
  console.log(`  Durchschnitt:          €${countable > 0 ? (totalGross / countable).toFixed(2) : '0.00'}`)

  console.log(`\n── Dashboard-Vergleich ──\n`)
  console.log(`  Dashboard zeigt:   إيرادات اليوم = €669.99`)
  console.log(`  Berechnet:         €${totalGross.toFixed(2)}`)
  console.log(`  Match:             ${Math.abs(totalGross - 669.99) < 0.02 ? '✅' : '❌ ABWEICHUNG'}`)
  console.log(`  Dashboard zeigt:   صافي = €690.00`)
  console.log(`  Berechnet (netto): €${(totalGross - totalRefunded).toFixed(2)}`)
  console.log(`  Dashboard zeigt:   الطلبات = 2`)
  console.log(`  Berechnet:         ${countable}`)
  console.log(`  Dashboard zeigt:   متوسط = €335.00`)
  console.log(`  Berechnet:         €${countable > 0 ? (totalGross / countable).toFixed(2) : '0.00'}`)

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
