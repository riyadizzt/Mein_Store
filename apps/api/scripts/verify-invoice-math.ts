/**
 * Read-only live-DB check: verifies the net + tax = gross invariant
 * on every Invoice row created in the last 24 hours.
 *
 * Usage:
 *   tsx scripts/verify-invoice-math.ts
 *
 * Exit code 0 if all invariants hold (1-cent tolerance).
 * Exit code 1 if any drift found — prints offending rows.
 *
 * NEVER modifies DB. GoBD trigger untouched.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client')

const TOLERANCE = 0.01  // 1 cent

async function main() {
  const prisma = new PrismaClient()

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const invoices = await prisma.invoice.findMany({
    where: { createdAt: { gte: since } },
    select: {
      id: true,
      invoiceNumber: true,
      type: true,
      netAmount: true,
      taxAmount: true,
      grossAmount: true,
      createdAt: true,
      order: { select: { orderNumber: true, subtotal: true, totalAmount: true, discountAmount: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  console.log(`Scanned ${invoices.length} invoices from last 24h\n`)

  let driftCount = 0
  for (const inv of invoices) {
    const net = Number(inv.netAmount)
    const tax = Number(inv.taxAmount)
    const gross = Number(inv.grossAmount)
    const computed = net + tax
    const drift = Math.abs(computed - gross)

    if (drift > TOLERANCE) {
      driftCount++
      console.log(
        `DRIFT  ${inv.invoiceNumber}  [${inv.type}]  order=${inv.order?.orderNumber ?? '—'}`,
      )
      console.log(`       net=€${net.toFixed(2)}  tax=€${tax.toFixed(2)}  gross=€${gross.toFixed(2)}`)
      console.log(`       net+tax=€${computed.toFixed(2)}  drift=€${drift.toFixed(2)}`)
      if (inv.order) {
        console.log(`       order.subtotal=€${Number(inv.order.subtotal).toFixed(2)}  order.discount=€${Number(inv.order.discountAmount ?? 0).toFixed(2)}  order.total=€${Number(inv.order.totalAmount).toFixed(2)}`)
        // Classic symptom: net == subtotal (pre-discount) while gross == totalAmount
        if (Math.abs(net - Number(inv.order.subtotal)) < TOLERANCE && Math.abs(gross - Number(inv.order.totalAmount)) < TOLERANCE) {
          console.log(`       ⚠ matches pre-fix bug signature (netAmount = order.subtotal)`)
        }
      }
      console.log('')
    }
  }

  if (driftCount === 0) {
    console.log('✓ All invoice math invariants hold (net + tax = gross, ±1 cent)')
  } else {
    console.log(`✗ ${driftCount} invoice(s) drift beyond ${TOLERANCE}-cent tolerance`)
  }

  await prisma.$disconnect()
  process.exit(driftCount === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('Script failed:', err)
  process.exit(2)
})
