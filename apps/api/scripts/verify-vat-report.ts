/**
 * Live-DB smoke for the VAT-report fix.
 *
 * Read-only. Runs the NEW (post-discount-correct) query and the OLD
 * (pre-discount-buggy) query against the same period, reports both.
 * Also sums order.total_amount / order.tax_amount directly as ground
 * truth so the operator can see that "new SQL agrees with DB totals,
 * old SQL inflates them when any order carries a discount".
 *
 * Exit 0 regardless — this is diagnostic, not a gate.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client')

async function main() {
  const prisma = new PrismaClient()

  // Period: current month — covers ORD-20260420-000001 and any other
  // recent coupon orders where the bug would manifest.
  const start = new Date('2026-04-01T00:00:00.000Z')
  const end = new Date('2026-04-30T23:59:59.999Z')

  const CHANNELS = ['website', 'mobile', 'facebook', 'instagram', 'tiktok', 'google', 'whatsapp']
  const STATUSES = ['confirmed', 'processing', 'shipped', 'delivered', 'returned', 'refunded']

  console.log(`Period: ${start.toISOString().slice(0, 10)} … ${end.toISOString().slice(0, 10)}\n`)

  // ── Ground truth from order-level columns ────────────────────
  const truth = await prisma.order.aggregate({
    where: {
      createdAt: { gte: start, lte: end },
      channel: { in: CHANNELS },
      status: { in: STATUSES },
      deletedAt: null,
    },
    _sum: { totalAmount: true, taxAmount: true, discountAmount: true, subtotal: true },
    _count: true,
  })
  const gt = {
    orderCount: truth._count,
    gross: Number(truth._sum.totalAmount ?? 0),
    tax: Number(truth._sum.taxAmount ?? 0),
    discount: Number(truth._sum.discountAmount ?? 0),
    subtotal: Number(truth._sum.subtotal ?? 0),
  }
  console.log('Ground truth (order-level columns):')
  console.log(`  orders:    ${gt.orderCount}`)
  console.log(`  subtotal:  €${gt.subtotal.toFixed(2)}  (pre-discount items sum)`)
  console.log(`  discount:  €${gt.discount.toFixed(2)}`)
  console.log(`  gross:     €${gt.gross.toFixed(2)}  (subtotal - discount + shipping)`)
  console.log(`  tax:       €${gt.tax.toFixed(2)}   (MwSt rausgerechnet from gross)`)

  // ── OLD bug-query ────────────────────────────────────────────
  const oldRows: any = await prisma.$queryRaw`
    SELECT
      oi.tax_rate,
      COALESCE(SUM(CAST(oi.total_price AS DECIMAL(10,2))), 0) AS gross_amount,
      COALESCE(SUM(
        CAST(oi.total_price AS DECIMAL(10,2)) -
        CAST(oi.total_price AS DECIMAL(10,2)) /
        (1 + CAST(oi.tax_rate AS DECIMAL(5,2)) / 100)
      ), 0) AS tax_amount
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.created_at >= ${start}
      AND o.created_at <= ${end}
      AND o.channel IN ('website', 'mobile', 'facebook', 'instagram', 'tiktok', 'google', 'whatsapp')
      AND o.status IN ('confirmed', 'processing', 'shipped', 'delivered', 'returned', 'refunded')
      AND o.deleted_at IS NULL
    GROUP BY oi.tax_rate
  `
  const oldTotalGross = oldRows.reduce((s: number, r: any) => s + Number(r.gross_amount), 0)
  const oldTotalTax = oldRows.reduce((s: number, r: any) => s + Number(r.tax_amount), 0)
  console.log('\nOLD query (pre-discount bug):')
  for (const r of oldRows) {
    console.log(`  ${r.tax_rate}%:  gross=€${Number(r.gross_amount).toFixed(2)}  tax=€${Number(r.tax_amount).toFixed(2)}`)
  }
  console.log(`  total:  gross=€${oldTotalGross.toFixed(2)}  tax=€${oldTotalTax.toFixed(2)}`)

  // ── NEW pro-rated query ──────────────────────────────────────
  const newRows: any = await prisma.$queryRaw`
    WITH order_rate_shares AS (
      SELECT
        oi.tax_rate,
        o.id AS order_id,
        o.total_amount,
        o.tax_amount,
        o.subtotal,
        SUM(CAST(oi.total_price AS DECIMAL(10,2))) AS rate_items_sum
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.created_at >= ${start}
        AND o.created_at <= ${end}
        AND o.channel IN ('website', 'mobile', 'facebook', 'instagram', 'tiktok', 'google', 'whatsapp')
        AND o.status IN ('confirmed', 'processing', 'shipped', 'delivered', 'returned', 'refunded')
        AND o.deleted_at IS NULL
        AND o.subtotal > 0
      GROUP BY oi.tax_rate, o.id, o.total_amount, o.tax_amount, o.subtotal
    )
    SELECT
      tax_rate,
      COALESCE(SUM(total_amount * (rate_items_sum / subtotal)), 0) AS gross_amount,
      COALESCE(SUM(tax_amount * (rate_items_sum / subtotal)), 0) AS tax_amount
    FROM order_rate_shares
    GROUP BY tax_rate
  `
  const newTotalGross = newRows.reduce((s: number, r: any) => s + Number(r.gross_amount), 0)
  const newTotalTax = newRows.reduce((s: number, r: any) => s + Number(r.tax_amount), 0)
  console.log('\nNEW query (post-discount, pro-rated):')
  for (const r of newRows) {
    console.log(`  ${r.tax_rate}%:  gross=€${Number(r.gross_amount).toFixed(2)}  tax=€${Number(r.tax_amount).toFixed(2)}`)
  }
  console.log(`  total:  gross=€${newTotalGross.toFixed(2)}  tax=€${newTotalTax.toFixed(2)}`)

  // ── Agreement check ─────────────────────────────────────────
  const grossDrift = Math.abs(newTotalGross - gt.gross)
  const taxDrift = Math.abs(newTotalTax - gt.tax)
  console.log('\nAgreement with ground truth (NEW query vs order-level sums):')
  console.log(`  gross drift: €${grossDrift.toFixed(4)}  ${grossDrift < 0.02 ? '✓' : '✗'}`)
  console.log(`  tax drift:   €${taxDrift.toFixed(4)}  ${taxDrift < 0.02 ? '✓' : '✗'}`)

  const discountDelta = oldTotalTax - newTotalTax
  console.log(`\nOld-query VAT inflation: €${discountDelta.toFixed(2)} (attributable to discount ignored)`)

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
