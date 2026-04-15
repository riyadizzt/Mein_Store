/**
 * Reconcile inventory.quantityReserved counters against the actual sum of
 * stock_reservations rows with status=RESERVED.
 *
 * Read-only dry-run by default. Pass --apply to actually write.
 *
 * Why this is needed: historical drift. Before today's lifecycle fix,
 * reservations could be status-flipped to EXPIRED/RELEASED without
 * decrementing the denormalized counter on inventory. Over time the
 * counter drifted upward, locking phantom stock out of the sellable pool.
 *
 * Safety:
 *   - Single transaction (all-or-nothing).
 *   - Only updates inventory rows whose counter disagrees with the
 *     aggregated reservation sum.
 *   - Never touches quantityOnHand, reorderPoint, or any other field.
 *   - Never touches stock_reservations rows — only the inventory counter.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

async function main() {
  console.log(`\n── Inventory reserved-counter reconciliation ──`)
  console.log(`   mode: ${APPLY ? '🔥 APPLY (writes)' : '👁  DRY-RUN (no writes)'}\n`)

  // 1. Pull every inventory row with its variant + warehouse labels for reporting
  const inventories = await prisma.inventory.findMany({
    select: {
      id: true,
      variantId: true,
      warehouseId: true,
      quantityOnHand: true,
      quantityReserved: true,
      variant: { select: { sku: true } },
      warehouse: { select: { name: true } },
    },
  })
  console.log(`   scanned ${inventories.length} inventory rows\n`)

  // 2. Pull the grouped sum of ACTIVE reservations in a single query
  const reservationAgg = await prisma.stockReservation.groupBy({
    by: ['variantId', 'warehouseId'],
    where: { status: 'RESERVED' },
    _sum: { quantity: true },
  })
  const actualMap = new Map<string, number>()
  for (const row of reservationAgg) {
    actualMap.set(`${row.variantId}::${row.warehouseId}`, row._sum.quantity ?? 0)
  }
  console.log(`   found ${reservationAgg.length} (variant×warehouse) combos with active RESERVED rows\n`)

  // 3. Diff
  type Drift = {
    invId: string
    sku: string
    warehouseName: string
    counter: number
    actual: number
    delta: number
    onHand: number
  }
  const drifts: Drift[] = []
  for (const inv of inventories) {
    const actual = actualMap.get(`${inv.variantId}::${inv.warehouseId}`) ?? 0
    if (inv.quantityReserved !== actual) {
      drifts.push({
        invId: inv.id,
        sku: inv.variant.sku,
        warehouseName: inv.warehouse.name,
        counter: inv.quantityReserved,
        actual,
        delta: inv.quantityReserved - actual,
        onHand: inv.quantityOnHand,
      })
    }
  }

  if (drifts.length === 0) {
    console.log('   ✅ No drift. Every inventory counter matches the actual reservation sum.\n')
    await prisma.$disconnect()
    return
  }

  // 4. Report
  const upward = drifts.filter((d) => d.delta > 0)   // counter too high (phantom locked)
  const downward = drifts.filter((d) => d.delta < 0) // counter too low (under-locked)
  const totalPhantomUnits = upward.reduce((s, d) => s + d.delta, 0)
  const totalUnderlockedUnits = downward.reduce((s, d) => s + Math.abs(d.delta), 0)

  console.log(`   Found ${drifts.length} drifted inventory row(s):\n`)
  console.log(`   ${upward.length.toString().padStart(3)} counter too HIGH  (phantom units locked) → +${totalPhantomUnits} phantom units`)
  console.log(`   ${downward.length.toString().padStart(3)} counter too LOW   (under-locked)        → ${totalUnderlockedUnits} missing locks\n`)

  // Sort by biggest drift first
  drifts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  console.log(`   ── Top 30 by drift magnitude ──`)
  console.log(`   ${'SKU'.padEnd(22)} ${'Warehouse'.padEnd(20)} ${'onHand'.padStart(7)} ${'counter'.padStart(9)} ${'actual'.padStart(8)} ${'delta'.padStart(8)}`)
  console.log(`   ${'─'.repeat(22)} ${'─'.repeat(20)} ${'─'.repeat(7)} ${'─'.repeat(9)} ${'─'.repeat(8)} ${'─'.repeat(8)}`)
  for (const d of drifts.slice(0, 30)) {
    const sign = d.delta > 0 ? '+' : ''
    console.log(`   ${d.sku.padEnd(22)} ${d.warehouseName.padEnd(20)} ${String(d.onHand).padStart(7)} ${String(d.counter).padStart(9)} ${String(d.actual).padStart(8)} ${(sign + d.delta).padStart(8)}`)
  }
  if (drifts.length > 30) {
    console.log(`   … and ${drifts.length - 30} more\n`)
  } else {
    console.log()
  }

  // 5. Apply
  if (!APPLY) {
    console.log(`   DRY-RUN — no changes made.`)
    console.log(`   Re-run with --apply to reconcile these ${drifts.length} row(s).\n`)
    await prisma.$disconnect()
    return
  }

  console.log(`   Applying in a single transaction…\n`)
  await prisma.$transaction(
    drifts.map((d) =>
      prisma.inventory.update({
        where: { id: d.invId },
        data: { quantityReserved: d.actual },
      }),
    ),
  )
  console.log(`   ✅ Reconciled ${drifts.length} inventory row(s).\n`)

  // 6. Verify
  console.log(`   ── Verification pass ──`)
  const verify = await prisma.inventory.findMany({
    where: { id: { in: drifts.map((d) => d.invId) } },
    select: { id: true, quantityReserved: true, variantId: true, warehouseId: true },
  })
  let verifyOk = 0
  let verifyFail = 0
  for (const v of verify) {
    const actual = actualMap.get(`${v.variantId}::${v.warehouseId}`) ?? 0
    if (v.quantityReserved === actual) verifyOk++
    else verifyFail++
  }
  console.log(`   ${verifyOk} row(s) now match, ${verifyFail} still mismatched.\n`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
