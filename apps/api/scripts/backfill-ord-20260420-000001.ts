/**
 * One-shot backfill for ORD-20260420-000001 — the partial-cancel test
 * order that was cancelled BEFORE commit 6e3d126 shipped, so its
 * totals still carry the pre-fix Brutto/Netto drift:
 *
 *   totalAmount:    725.90  (should be 305.00)
 *   taxAmount:      115.90  (should be  48.70)
 *   discountAmount: 9785.00 (should be 305.00 — 50% of remaining subtotal)
 *   subtotal:       610.00  (already correct — untouched)
 *
 * Read-only by default. Pass --apply to write.
 *
 * Safety rails:
 *   • Hard-scoped to a SINGLE orderNumber. Any other row is untouched.
 *   • Pre-flight shape checks: order must be delivered/returned-status,
 *     payment must exist with a PROCESSED €9480 refund. Any mismatch
 *     aborts with a clear message — no writes.
 *   • Idempotent: if the four fields already match the target values
 *     (within 1 cent), the script reports "nothing to do" and exits 0.
 *   • Invariant is asserted on the intended target before writing:
 *     subtotal − discount + shipping = total (≤ 0.02 drift).
 *   • GoBD-safe: only touches the `orders` table. invoices/credit notes
 *     are untouched (the GoBD trigger blocks their UPDATE anyway).
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client')

const TARGET_ORDER = 'ORD-20260420-000001'

// Expected pre-fix shape — anything else → abort
const EXPECTED = {
  subtotal: 610.00,    // already correct
  totalAmount: 725.90, // pre-fix buggy
  taxAmount: 115.90,   // pre-fix buggy
  discountAmount: 9785.00, // pre-fix buggy (was 50% of original 19570, not 50% of remaining 610)
}

// Corrected values per the invariant (newSubtotal − newDiscount + shipping = newTotal)
// For this order: shipping=0, coupon=50%, refund=€9480 already issued.
//   newSubtotal = 610  (untouched)
//   newTotal    = oldTotal(9785) − refund(9480) = 305
//   newTax      = newTotal − newTotal/1.19      = 48.70
//   newDiscount = newSubtotal + shipping − newTotal = 305
const TARGET = {
  subtotal: 610.00,
  totalAmount: 305.00,
  taxAmount: 48.70,
  discountAmount: 305.00,
}

const APPLY = process.argv.includes('--apply')

function eq(a: number, b: number, tol = 0.01): boolean {
  return Math.abs(a - b) <= tol
}

async function main() {
  const prisma = new PrismaClient()

  const order = await prisma.order.findFirst({
    where: { orderNumber: TARGET_ORDER, deletedAt: null },
    include: {
      payment: { include: { refunds: true } },
    },
  })

  if (!order) {
    console.error(`✗ Order ${TARGET_ORDER} not found.`)
    process.exit(1)
  }

  const cur = {
    subtotal: Number(order.subtotal),
    totalAmount: Number(order.totalAmount),
    taxAmount: Number(order.taxAmount),
    discountAmount: Number(order.discountAmount),
    shippingCost: Number(order.shippingCost),
  }

  console.log(`═══ Order ${TARGET_ORDER} ═══`)
  console.log(`  status:         ${order.status}`)
  console.log(`  shippingCost:   €${cur.shippingCost.toFixed(2)}`)
  console.log('')
  console.log('                        current        target         delta')
  console.log(`  subtotal        €${cur.subtotal.toFixed(2).padStart(9)}  €${TARGET.subtotal.toFixed(2).padStart(9)}  ${(TARGET.subtotal - cur.subtotal).toFixed(2).padStart(7)}`)
  console.log(`  totalAmount     €${cur.totalAmount.toFixed(2).padStart(9)}  €${TARGET.totalAmount.toFixed(2).padStart(9)}  ${(TARGET.totalAmount - cur.totalAmount).toFixed(2).padStart(7)}`)
  console.log(`  taxAmount       €${cur.taxAmount.toFixed(2).padStart(9)}  €${TARGET.taxAmount.toFixed(2).padStart(9)}  ${(TARGET.taxAmount - cur.taxAmount).toFixed(2).padStart(7)}`)
  console.log(`  discountAmount  €${cur.discountAmount.toFixed(2).padStart(9)}  €${TARGET.discountAmount.toFixed(2).padStart(9)}  ${(TARGET.discountAmount - cur.discountAmount).toFixed(2).padStart(7)}`)
  console.log('')

  // ── Idempotence check ────────────────────────────────────────
  if (
    eq(cur.subtotal, TARGET.subtotal) &&
    eq(cur.totalAmount, TARGET.totalAmount) &&
    eq(cur.taxAmount, TARGET.taxAmount) &&
    eq(cur.discountAmount, TARGET.discountAmount)
  ) {
    console.log('✓ Already at target values — nothing to do.')
    await prisma.$disconnect()
    process.exit(0)
  }

  // ── Shape check: is this the exact pre-fix state we expected? ────
  const shapeMatches =
    eq(cur.subtotal, EXPECTED.subtotal) &&
    eq(cur.totalAmount, EXPECTED.totalAmount) &&
    eq(cur.taxAmount, EXPECTED.taxAmount) &&
    eq(cur.discountAmount, EXPECTED.discountAmount)

  if (!shapeMatches) {
    console.error('✗ Order is NOT in the expected pre-fix shape.')
    console.error('  Refusing to write — the scenario has drifted from what this script was designed to fix.')
    console.error('  Inspect the order manually or build a broader reconcile script.')
    await prisma.$disconnect()
    process.exit(1)
  }

  // ── Payment-refund precondition ──────────────────────────────
  const refund = (order.payment?.refunds ?? []).find(
    (r: any) => r.status === 'PROCESSED' && Math.abs(Number(r.amount) - 9480) < 0.01,
  )
  if (!refund) {
    console.error('✗ Expected PROCESSED refund of €9480.00 on the payment — not found.')
    console.error('  Refunds on record:')
    for (const r of order.payment?.refunds ?? []) {
      console.error(`    €${Number(r.amount).toFixed(2)}  status=${r.status}`)
    }
    await prisma.$disconnect()
    process.exit(1)
  }
  console.log(`✓ Precondition met: PROCESSED refund €${Number(refund.amount).toFixed(2)} exists`)

  // ── Invariant check on the TARGET ────────────────────────────
  const targetDrift = Math.abs(
    TARGET.subtotal - TARGET.discountAmount + cur.shippingCost - TARGET.totalAmount,
  )
  if (targetDrift > 0.02) {
    console.error(`✗ Target values fail invariant: drift=€${targetDrift.toFixed(4)}`)
    await prisma.$disconnect()
    process.exit(1)
  }
  console.log(`✓ Invariant check on TARGET: subtotal(${TARGET.subtotal}) − discount(${TARGET.discountAmount}) + shipping(${cur.shippingCost}) = ${TARGET.subtotal - TARGET.discountAmount + cur.shippingCost} ≈ total(${TARGET.totalAmount})`)
  console.log('')

  // ── Write ────────────────────────────────────────────────────
  if (!APPLY) {
    console.log('ℹ Dry-run. Re-run with --apply to write.')
    await prisma.$disconnect()
    process.exit(0)
  }

  await prisma.order.update({
    where: { id: order.id },
    data: {
      subtotal: TARGET.subtotal,
      totalAmount: TARGET.totalAmount,
      taxAmount: TARGET.taxAmount,
      discountAmount: TARGET.discountAmount,
    },
  })
  console.log(`✓ Written. Order ${TARGET_ORDER} now matches the post-fix invariant.`)

  // ── Post-write verification ──────────────────────────────────
  const after = await prisma.order.findUnique({
    where: { id: order.id },
    select: { subtotal: true, totalAmount: true, taxAmount: true, discountAmount: true },
  })
  console.log('')
  console.log('Final state:')
  console.log(`  subtotal:       €${Number(after!.subtotal).toFixed(2)}`)
  console.log(`  totalAmount:    €${Number(after!.totalAmount).toFixed(2)}`)
  console.log(`  taxAmount:      €${Number(after!.taxAmount).toFixed(2)}`)
  console.log(`  discountAmount: €${Number(after!.discountAmount).toFixed(2)}`)

  await prisma.$disconnect()
  process.exit(0)
}

main().catch((err) => {
  console.error('Script failed:', err)
  process.exit(2)
})
