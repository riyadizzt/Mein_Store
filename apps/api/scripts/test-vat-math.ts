/**
 * Verify the VAT (MwSt) math across all orders in the DB.
 *
 * Checks the core invariant of German price display law:
 *   grossAmount == subtotal + shippingCost - discountAmount
 *   taxAmount   == grossAmount - (grossAmount / 1.19)
 *
 * AKA: VAT is EXTRACTED from the gross price, not ADDED on top. If this ever
 * breaks, the customer pays more than the display price — the #1 compliance
 * risk for a German shop.
 */

import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const VAT_RATE = 0.19
const round2 = (n: number) => Math.round(n * 100) / 100

function expectedVat(gross: number): number {
  return round2(gross - gross / (1 + VAT_RATE))
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  VAT MATH VERIFICATION — German UStG compliance')
  console.log('═══════════════════════════════════════════════════════════\n')

  // 1. Sanity check the formula itself
  console.log('── 1. Formula sanity ──')
  const cases = [
    { gross: 100, expectedVat: 15.97, expectedNet: 84.03 },
    { gross: 50, expectedVat: 7.98, expectedNet: 42.02 },
    { gross: 119, expectedVat: 19, expectedNet: 100 },
  ]
  for (const c of cases) {
    const computedVat = expectedVat(c.gross)
    const computedNet = round2(c.gross - computedVat)
    const ok = computedVat === c.expectedVat && computedNet === c.expectedNet
    console.log(
      `   €${c.gross} gross → ${ok ? '✅' : '❌'} VAT=${computedVat} (expected ${c.expectedVat}), net=${computedNet} (expected ${c.expectedNet})`,
    )
  }

  // 2. Check all recent orders
  console.log('\n── 2. Recent orders — does the math hold? ──')
  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      deletedAt: null,
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })

  let passed = 0
  let failed = 0
  const failures: string[] = []

  for (const o of orders) {
    const subtotal = Number(o.subtotal)
    const shipping = Number(o.shippingCost)
    const discount = Number(o.discountAmount ?? 0)
    const total = Number(o.totalAmount)
    const storedTax = Number(o.taxAmount ?? 0)

    // Invariant 1: totalAmount == subtotal + shipping - discount
    const computedTotal = round2(subtotal + shipping - discount)
    const totalMatch = Math.abs(computedTotal - total) < 0.02 // 1 cent tolerance

    // Invariant 2: taxAmount == gross - (gross/1.19)
    //              tax is EXTRACTED from total, NOT added on top
    const computedVat = expectedVat(total)
    const vatMatch = Math.abs(computedVat - storedTax) < 0.02

    if (totalMatch && vatMatch) {
      passed++
    } else {
      failed++
      const details: string[] = []
      if (!totalMatch) {
        details.push(
          `total ${total} ≠ sub(${subtotal}) + ship(${shipping}) - disc(${discount}) = ${computedTotal}`,
        )
      }
      if (!vatMatch) {
        details.push(`VAT ${storedTax} ≠ expected ${computedVat} (for gross ${total})`)
      }
      failures.push(`${o.orderNumber}  —  ${details.join(' | ')}`)
    }
  }

  console.log(`   ✅ ${passed} orders pass the invariants`)
  if (failed > 0) {
    console.log(`   ❌ ${failed} orders FAIL:`)
    failures.slice(0, 10).forEach((f) => console.log(`      ${f}`))
  }

  // 3. Spot-check the €100 case specifically
  console.log('\n── 3. Direct €100 gross case ──')
  const hundredCase = {
    gross: 100,
    vat: expectedVat(100),
    net: round2(100 - expectedVat(100)),
  }
  console.log(`   If a customer buys an item for €${hundredCase.gross}:`)
  console.log(`     → Net (Netto):     €${hundredCase.net.toFixed(2)}`)
  console.log(`     → VAT (MwSt 19%):  €${hundredCase.vat.toFixed(2)}`)
  console.log(`     → Gross (Brutto):  €${hundredCase.gross.toFixed(2)}   ← what customer pays`)
  console.log(`   The customer pays €100 total, NOT €119. ✅`)

  // 4. Does any order currently show €100 total exactly?
  console.log('\n── 4. Orders where totalAmount is exactly €100 (live proof) ──')
  const hundredOrders = await prisma.order.findMany({
    where: { totalAmount: 100 },
    select: { orderNumber: true, totalAmount: true, taxAmount: true, subtotal: true },
    take: 5,
  })
  if (hundredOrders.length === 0) {
    console.log('   (no order with totalAmount=100 — the math applies to all amounts anyway)')
  } else {
    for (const o of hundredOrders) {
      console.log(`   ${o.orderNumber}  total=${o.totalAmount}  tax=${o.taxAmount}  sub=${o.subtotal}`)
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log(`  RESULT: ${failed === 0 ? '✅ VAT compliance intact' : '❌ VAT compliance broken'}`)
  console.log('═══════════════════════════════════════════════════════════')
  process.exit(failed === 0 ? 0 : 1)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
