/**
 * Diagnostic: list every inventory intake movement from the last 24h
 * grouped by warehouse. Used to identify which intakes landed in the
 * wrong warehouse due to the 14.04.2026 scanner bug where the frontend
 * took inventory[0] (usually Marzahn) regardless of the selected
 * warehouse.
 *
 * Prints one block per warehouse with:
 *   - Movement count
 *   - Total units added
 *   - Per-variant breakdown (SKU, product name, quantity, movement time)
 *
 * Read-only. Does not modify any data. Prints a suggested transfer
 * command for each potentially-misrouted movement.
 */

import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const movements = await prisma.inventoryMovement.findMany({
    where: {
      createdAt: { gte: cutoff },
      type: 'purchase_received',
    },
    orderBy: { createdAt: 'desc' },
  })

  const warehouses = await prisma.warehouse.findMany({ select: { id: true, name: true } })
  const whMap = new Map(warehouses.map((w) => [w.id, w.name]))

  // Batch-load variants referenced by today's movements
  const variantIdsInMovements = [...new Set(movements.map((m) => m.variantId))]
  const variantsList = await prisma.productVariant.findMany({
    where: { id: { in: variantIdsInMovements } },
    select: {
      id: true, sku: true, color: true, size: true,
      product: { select: { translations: { select: { language: true, name: true } } } },
    },
  })
  const variantMap = new Map(variantsList.map((v) => [v.id, v]))

  console.log('═══════════════════════════════════════════════════════════')
  console.log(`  INVENTORY INTAKE — last 24h — ${movements.length} movements`)
  console.log('═══════════════════════════════════════════════════════════\n')

  if (movements.length === 0) {
    console.log('No purchase_received movements in the last 24h.')
    await prisma.$disconnect()
    return
  }

  // Group by warehouse
  const byWh: Record<string, typeof movements> = {}
  for (const m of movements) {
    const key = m.warehouseId
    if (!byWh[key]) byWh[key] = []
    byWh[key].push(m)
  }

  for (const [whId, items] of Object.entries(byWh)) {
    const whName = whMap.get(whId) ?? `(unknown warehouse ${whId.slice(0, 8)})`
    const totalUnits = items.reduce((s, m) => s + m.quantity, 0)
    console.log(`── ${whName} ──  ${items.length} movements, ${totalUnits} units`)
    console.log(`   warehouse id: ${whId}\n`)

    for (const m of items) {
      const v = variantMap.get(m.variantId)
      const name =
        v?.product?.translations?.find((t: any) => t.language === 'de')?.name ??
        v?.product?.translations?.[0]?.name ??
        '(no name)'
      const variantInfo = [v?.color, v?.size].filter(Boolean).join(' / ')
      const time = m.createdAt.toISOString().slice(11, 19)
      console.log(`   ${time}  +${m.quantity.toString().padStart(3, ' ')}  ${v?.sku ?? '?'}  ${name}${variantInfo ? ` (${variantInfo})` : ''}`)
      console.log(`           ${m.quantityBefore} → ${m.quantityAfter}  notes: ${m.notes?.slice(0, 40) ?? '—'}`)
    }
    console.log()
  }

  // Cross-check: do any of these movements look "wrong" — i.e., stock
  // exists in another warehouse too (which is the tell-tale sign of a
  // scanner bug where [0] was picked blindly).
  console.log('── Cross-variant check: items that have stock in multiple warehouses ──\n')
  const variantIds = [...new Set(movements.map((m) => m.variantId))]
  let multiCount = 0
  for (const variantId of variantIds) {
    const rows = await prisma.inventory.findMany({
      where: { variantId },
      select: { warehouseId: true, quantityOnHand: true },
    })
    if (rows.length > 1) {
      multiCount++
      const variant = await prisma.productVariant.findUnique({
        where: { id: variantId },
        select: { sku: true, product: { select: { translations: { take: 1 } } } },
      })
      const name = variant?.product?.translations?.[0]?.name ?? '?'
      console.log(`  ⚠ ${variant?.sku}  ${name}`)
      for (const r of rows) {
        console.log(`       ${whMap.get(r.warehouseId) ?? r.warehouseId.slice(0, 8)}: ${r.quantityOnHand} Stück`)
      }
    }
  }
  if (multiCount === 0) {
    console.log('  (no multi-warehouse variants found among today\'s intakes)')
  }

  console.log('\n── Transfer hint ──')
  console.log('If any intake above landed in the WRONG warehouse, transfer it with:')
  console.log('  POST /admin/inventory/<inventoryId>/transfer { toWarehouseId, quantity }')
  console.log('Or use the admin UI at /admin/inventory/transfer.')

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
