/**
 * Full inventory drift reconciliation — BOTH counters.
 *
 * Extends the 16.04.2026 `reconcile-reserved-counters.ts` script with a
 * second pass: for every row whose `quantityReserved` drifted, check the
 * movement log for past `return_received` events with "Order cancelled"
 * notes — these are exactly the movements produced by the now-fixed
 * cancelWithRefund / cancelItems bug from 17.04.2026. Each such movement
 * also inflated `quantityOnHand` by the same amount it drifted
 * `quantityReserved`, so the two cancel cleanly.
 *
 * DRY-RUN by default. Pass --apply to write.
 *
 * Safety:
 *   - Single transaction, all-or-nothing.
 *   - Only touches rows whose counter demonstrably drifted AND whose
 *     drift is explained by cancel-related movements.
 *   - Pure correction (no new data) — idempotent: running twice is a
 *     no-op after the first write.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

interface RowReport {
  invId: string
  variantId: string
  warehouseId: string
  sku: string
  warehouseName: string
  currentOnHand: number
  currentReserved: number
  actualReserved: number
  cancelInflation: number
  suggestedOnHand: number
  suggestedReserved: number
}

async function main() {
  console.log(`\n── Full inventory reconciliation (reserved + onHand) ──`)
  console.log(`   mode: ${APPLY ? '🔥 APPLY (writes)' : '👁  DRY-RUN (no writes)'}\n`)

  // 1. All inventory rows
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
  console.log(`   scanned ${inventories.length} inventory rows`)

  // 2. Aggregate actual RESERVED reservations per (variant, warehouse)
  const agg = await prisma.stockReservation.groupBy({
    by: ['variantId', 'warehouseId'],
    where: { status: 'RESERVED' },
    _sum: { quantity: true },
  })
  const actualMap = new Map<string, number>()
  for (const row of agg) actualMap.set(`${row.variantId}::${row.warehouseId}`, row._sum.quantity ?? 0)

  // 3. For every inventory row with drift, calculate the cancel-inflation
  // amount by summing past "Order cancelled"/"Partial cancel" movements.
  const drifts: RowReport[] = []
  for (const inv of inventories) {
    const key = `${inv.variantId}::${inv.warehouseId}`
    const actual = actualMap.get(key) ?? 0
    const diff = inv.quantityReserved - actual
    if (diff === 0) continue

    // How much of that drift is explained by the cancel bug?
    const cancelMovs = await prisma.inventoryMovement.findMany({
      where: {
        variantId: inv.variantId,
        warehouseId: inv.warehouseId,
        type: 'return_received',
        OR: [
          { notes: { contains: 'Order cancelled' } },
          { notes: { contains: 'Partial cancel' } },
        ],
      },
      select: { quantity: true },
    })
    const cancelInflation = cancelMovs.reduce((s, m) => s + m.quantity, 0)

    drifts.push({
      invId: inv.id,
      variantId: inv.variantId,
      warehouseId: inv.warehouseId,
      sku: inv.variant?.sku ?? '?',
      warehouseName: inv.warehouse?.name ?? '?',
      currentOnHand: inv.quantityOnHand,
      currentReserved: inv.quantityReserved,
      actualReserved: actual,
      cancelInflation,
      // Subtract as much as can be explained by the cancel bug. Never go negative.
      suggestedOnHand: Math.max(0, inv.quantityOnHand - Math.min(diff, cancelInflation)),
      suggestedReserved: actual,
    })
  }

  if (drifts.length === 0) {
    console.log(`\n   ✓ no drift — every counter matches reality.\n`)
    await prisma.$disconnect()
    return
  }

  // 4. Report
  console.log(`\n   Found ${drifts.length} drifting inventory rows:\n`)
  console.log(`   ${'SKU'.padEnd(22)} ${'Warehouse'.padEnd(24)} ${'onHand'.padStart(8)} ${'reserved'.padStart(10)} ${'→ true'.padStart(10)} ${'cancel-inflation'.padStart(18)}`)
  console.log(`   ${'─'.repeat(22)} ${'─'.repeat(24)} ${'─'.repeat(8)} ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(18)}`)
  for (const d of drifts) {
    const changes: string[] = []
    if (d.currentOnHand !== d.suggestedOnHand) changes.push(`onHand ${d.currentOnHand}→${d.suggestedOnHand}`)
    if (d.currentReserved !== d.suggestedReserved) changes.push(`reserved ${d.currentReserved}→${d.suggestedReserved}`)
    console.log(`   ${d.sku.padEnd(22)} ${d.warehouseName.padEnd(24)} ${String(d.currentOnHand).padStart(8)} ${String(d.currentReserved).padStart(10)} ${String(d.actualReserved).padStart(10)} ${String(d.cancelInflation).padStart(18)}`)
    if (changes.length > 0) console.log(`      → ${changes.join('  |  ')}`)
  }

  // 5. Summary metrics
  const totalReservedDrift = drifts.reduce((s, d) => s + (d.currentReserved - d.actualReserved), 0)
  const totalOnHandDelta = drifts.reduce((s, d) => s + (d.currentOnHand - d.suggestedOnHand), 0)
  console.log(`\n   Summary:`)
  console.log(`     Reserved drift total:   ${totalReservedDrift}  (inflated)`)
  console.log(`     onHand suggested delta: ${totalOnHandDelta}  (to deflate)`)
  console.log(`     Rows to fix:            ${drifts.length}`)

  if (!APPLY) {
    console.log(`\n   👁  DRY-RUN complete. Run with --apply to write the corrections.\n`)
    await prisma.$disconnect()
    return
  }

  // 6. Apply — single transaction
  console.log(`\n   🔥 Writing corrections...\n`)
  await prisma.$transaction(async (tx) => {
    for (const d of drifts) {
      await tx.inventory.update({
        where: { id: d.invId },
        data: {
          quantityOnHand: d.suggestedOnHand,
          quantityReserved: d.suggestedReserved,
        },
      })
    }
  })
  console.log(`   ✓ ${drifts.length} rows corrected.\n`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
