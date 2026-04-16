import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  // Check today's orders for correct math
  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0)
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999)

  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: start, lte: end },
      deletedAt: null,
      status: { in: ['confirmed', 'processing', 'shipped', 'delivered', 'returned'] },
      channel: { in: ['website', 'mobile'] },
    },
    select: { orderNumber: true, totalAmount: true, taxAmount: true, discountAmount: true, shippingCost: true, subtotal: true },
  })

  console.log('\n── Verifikation: Finanzbericht-Berechnung ──\n')
  console.log('  Pro Bestellung:')
  let sumGross = 0, sumTax = 0, sumDiscount = 0, sumShipping = 0
  for (const o of orders) {
    const gross = Number(o.totalAmount)
    const tax = Number(o.taxAmount)
    const disc = Number(o.discountAmount)
    const ship = Number(o.shippingCost)
    sumGross += gross; sumTax += tax; sumDiscount += disc; sumShipping += ship
    console.log(`    ${o.orderNumber}  brutto=€${gross.toFixed(2)}  mwst=€${tax.toFixed(2)}  rabatt=€${disc.toFixed(2)}  versand=€${ship.toFixed(2)}`)
    // Verify: brutto = subtotal + shipping - discount
    const expected = Number(o.subtotal) + ship - disc
    const match = Math.abs(gross - expected) < 0.02
    console.log(`      check: subtotal(${Number(o.subtotal).toFixed(2)}) + shipping(${ship.toFixed(2)}) - discount(${disc.toFixed(2)}) = ${expected.toFixed(2)} ${match ? '✅' : '❌'}`)
  }

  const net = sumGross - sumTax
  console.log('\n  Summen (was der Finanzbericht zeigen muss):')
  console.log(`    Brutto (totalAmount):  €${sumGross.toFixed(2)}  ← was Kunden bezahlt haben`)
  console.log(`    MwSt (taxAmount):      €${sumTax.toFixed(2)}  ← enthaltene 19% MwSt`)
  console.log(`    Netto (brutto-mwst):   €${net.toFixed(2)}  ← Umsatz ohne Steuer`)
  console.log(`    Rabatte:               €${sumDiscount.toFixed(2)}  ← gewährte Rabatte`)
  console.log(`    Versand:               €${sumShipping.toFixed(2)}  ← Versandkosten`)

  console.log('\n  VORHER (falsch):')
  const oldNet = orders.reduce((s, o) => s + Number(o.subtotal), 0)
  console.log(`    "net" = subtotal-Summe = €${oldNet.toFixed(2)}  ← Warenwert VOR Rabatt`)
  console.log(`    "tax" = brutto - subtotal = €${(sumGross - oldNet).toFixed(2)}  ← ${sumGross - oldNet < 0 ? '⚠️ NEGATIV!' : ''}`)

  console.log('\n  NACHHER (korrekt):')
  console.log(`    "net" = brutto - mwst = €${net.toFixed(2)}  ← für Finanzamt`)
  console.log(`    "tax" = taxAmount = €${sumTax.toFixed(2)}  ← aus DB, korrekt rausgerechnet`)

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
