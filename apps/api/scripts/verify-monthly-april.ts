import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const start = new Date('2026-04-01T00:00:00.000Z')
  const end = new Date('2026-04-30T23:59:59.999Z')

  const countableStatuses = ['confirmed', 'processing', 'shipped', 'delivered', 'returned']
  const onlineChannels = ['website', 'mobile', 'facebook', 'instagram', 'tiktok', 'google', 'whatsapp']

  // All counted orders for April
  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: start, lte: end },
      status: { in: countableStatuses as any },
      channel: { in: onlineChannels as any },
      deletedAt: null,
    },
    select: { totalAmount: true, taxAmount: true, discountAmount: true, shippingCost: true, subtotal: true },
  })

  const sumGross = orders.reduce((s, o) => s + Number(o.totalAmount), 0)
  const sumTax = orders.reduce((s, o) => s + Number(o.taxAmount), 0)
  const sumDiscount = orders.reduce((s, o) => s + Number(o.discountAmount), 0)
  const sumSubtotal = orders.reduce((s, o) => s + Number(o.subtotal), 0)
  const sumShipping = orders.reduce((s, o) => s + Number(o.shippingCost), 0)

  // Refunds
  const refunds = await prisma.refund.findMany({
    where: { createdAt: { gte: start, lte: end }, status: 'PROCESSED' },
    select: { amount: true },
  })
  const sumRefunds = refunds.reduce((s, r) => s + Number(r.amount), 0)

  const netAfterRefunds = sumGross - sumRefunds
  const netWithoutTax = sumGross - sumTax
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _taxOnNet = netAfterRefunds - (netAfterRefunds / 1.19); void _taxOnNet

  console.log(`\n── April 2026 Monatsbericht Verifikation ──\n`)
  console.log(`  Orders:              ${orders.length}`)
  console.log(`  Refunds:             ${refunds.length}\n`)
  console.log(`  ── Dashboard zeigt ──`)
  console.log(`  إجمالي الإيرادات:     €10,226.60`)
  console.log(`  ناقص المرتجعات:       -€4,477.66`)
  console.log(`  صافي الإيرادات:       €5,748.94`)
  console.log(`  صافي (بدون ضريبة):    €8,600.92`)
  console.log(`  ضريبة 19%:            €1,625.68`)
  console.log(`  ضريبة مستحقة:         €1,625.68\n`)
  console.log(`  ── Berechnet aus DB ──`)
  console.log(`  Brutto (totalAmount): €${sumGross.toFixed(2)}  ${Math.abs(sumGross - 10226.60) < 0.02 ? '✅' : '❌'}`)
  console.log(`  Erstattungen:         €${sumRefunds.toFixed(2)}  ${Math.abs(sumRefunds - 4477.66) < 0.02 ? '✅' : '❌'}`)
  console.log(`  Netto nach Erstatt.:  €${netAfterRefunds.toFixed(2)}  ${Math.abs(netAfterRefunds - 5748.94) < 0.02 ? '✅' : '❌'}`)
  console.log(`  MwSt (taxAmount):     €${sumTax.toFixed(2)}  ${Math.abs(sumTax - 1625.68) < 0.02 ? '✅' : '❌'}`)
  console.log(`  Netto ohne MwSt:      €${netWithoutTax.toFixed(2)}  ${Math.abs(netWithoutTax - 8600.92) < 0.02 ? '✅' : '❌'}`)
  console.log(`\n  ── Steuer-Gegenprobe ──`)
  console.log(`  Brutto ÷ 1.19 = €${(sumGross / 1.19).toFixed(2)}  (Netto)`)
  console.log(`  Brutto - Netto = €${(sumGross - sumGross / 1.19).toFixed(2)}  (MwSt)`)
  console.log(`  taxAmount Summe = €${sumTax.toFixed(2)}`)
  console.log(`  Differenz:       €${Math.abs(sumTax - (sumGross - sumGross / 1.19)).toFixed(2)} (Rundung)`)

  console.log(`\n  ── Rabatt-Info ──`)
  console.log(`  Rabatte gesamt:   €${sumDiscount.toFixed(2)}`)
  console.log(`  Versand gesamt:   €${sumShipping.toFixed(2)}`)
  console.log(`  Subtotal gesamt:  €${sumSubtotal.toFixed(2)}`)
  console.log(`  Check: subtotal + shipping - discount = €${(sumSubtotal + sumShipping - sumDiscount).toFixed(2)} vs brutto €${sumGross.toFixed(2)}`)

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
