/**
 * READ-ONLY diagnostic: does the Return-Scanner + Inspect double-restock
 * actually happen in production data?
 *
 * Methodology:
 *  • Scanner-Flow writes InventoryMovement(type='return_received', notes='Return scan: RET-...')
 *  • Inspect-Flow writes InventoryMovement(type='return_received', notes='Return restock: RET-...')
 *  • Both notes-prefixes are distinct — we can classify every historical movement.
 *
 * For each Return row:
 *   1. Count scanner-movements per (variantId)
 *   2. Count inspect-movements per (variantId)
 *   3. Compare warehouses (same vs. different)
 *   4. Aggregate system-wide drift
 *
 * Zero writes. All queries are SELECTs / findMany / count.
 * Finance/invoice/refund data is NEVER joined — we only read:
 *   - returns (status, returnNumber, returnItems JSON)
 *   - orders (id, status — NO financials)
 *   - inventory_movements (read-only, authoritative history)
 *   - product_variants (sku, label)
 */

try {
  const fs = require('node:fs')
  const path = require('node:path')
  const envText = fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8')
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(m[1] in process.env)) process.env[m[1]] = v
  }
} catch {}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require('@prisma/client')
const prisma: any = new PrismaClient()

interface MovementRow {
  id: string
  variantId: string
  warehouseId: string
  type: string
  quantity: number
  notes: string | null
  referenceId: string | null
  createdAt: Date
  warehouseName: string
  sku: string
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('  Return Double-Restock Diagnostic — READ ONLY')
  console.log('═══════════════════════════════════════════════════════════\n')

  // ── 1. Fetch all returns ──
  const allReturns = await prisma.return.findMany({
    select: {
      id: true,
      returnNumber: true,
      orderId: true,
      status: true,
      createdAt: true,
      receivedAt: true,
      inspectedAt: true,
      returnItems: true,
      order: { select: { orderNumber: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  console.log(`  📊 Total returns in DB: ${allReturns.length}\n`)

  if (allReturns.length === 0) {
    console.log('  No returns found. Nothing to analyze.')
    await prisma.$disconnect()
    return
  }

  // ── 2. Fetch all return_received movements ──
  //
  // Scanner writes notes='Return scan: <RET-NR>'
  // Inspect  writes notes='Return restock: <RET-NR>'
  // We fetch both prefixes + any with referenceId matching a known orderId.
  const returnNumbers = allReturns.map((r: any) => r.returnNumber).filter(Boolean)
  const orderIds = allReturns.map((r: any) => r.orderId)

  const movements = await prisma.inventoryMovement.findMany({
    where: {
      type: 'return_received',
      OR: [
        { notes: { startsWith: 'Return scan:' } },
        { notes: { startsWith: 'Return restock:' } },
        { referenceId: { in: orderIds } },
      ],
    },
    select: {
      id: true,
      variantId: true,
      warehouseId: true,
      type: true,
      quantity: true,
      notes: true,
      referenceId: true,
      createdAt: true,
      createdBy: true,
      warehouse: { select: { name: true } },
      variant: { select: { sku: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`  📊 Total return_received movements (scan+inspect flows): ${movements.length}\n`)

  // ── 3. Classify movements by flow ──
  const scannerByReturn = new Map<string, MovementRow[]>() // returnNumber → movements
  const inspectByReturn = new Map<string, MovementRow[]>() // returnNumber → movements
  const orphanByOrder = new Map<string, MovementRow[]>() // orderId → movements (legacy)

  for (const m of movements) {
    const notes = m.notes ?? ''
    const row: MovementRow = {
      id: m.id,
      variantId: m.variantId,
      warehouseId: m.warehouseId,
      type: m.type,
      quantity: m.quantity,
      notes: m.notes,
      referenceId: m.referenceId,
      createdAt: m.createdAt,
      warehouseName: m.warehouse?.name ?? '?',
      sku: m.variant?.sku ?? '?',
    }

    if (notes.startsWith('Return scan:')) {
      const rn = notes.replace('Return scan:', '').trim()
      if (!scannerByReturn.has(rn)) scannerByReturn.set(rn, [])
      scannerByReturn.get(rn)!.push(row)
    } else if (notes.startsWith('Return restock:')) {
      const rn = notes.replace('Return restock:', '').trim()
      if (!inspectByReturn.has(rn)) inspectByReturn.set(rn, [])
      inspectByReturn.get(rn)!.push(row)
    } else if (m.referenceId) {
      if (!orphanByOrder.has(m.referenceId)) orphanByOrder.set(m.referenceId, [])
      orphanByOrder.get(m.referenceId)!.push(row)
    }
  }

  // ── 4. Per-return analysis ──
  interface ReturnAnalysis {
    returnNumber: string
    returnId: string
    orderNumber: string
    status: string
    createdAt: Date
    receivedAt: Date | null
    inspectedAt: Date | null
    scannerMovements: MovementRow[]
    inspectMovements: MovementRow[]
    orphanMovements: MovementRow[]
    scannerCount: number
    inspectCount: number
    orphanCount: number
    totalMovements: number
    sameWarehouse: boolean | null // true if all movements at same wh, null if N/A
    totalScannerQty: number
    totalInspectQty: number
  }

  const analyses: ReturnAnalysis[] = []

  for (const ret of allReturns) {
    const scanner = (ret.returnNumber ? scannerByReturn.get(ret.returnNumber) : null) ?? []
    const inspect = (ret.returnNumber ? inspectByReturn.get(ret.returnNumber) : null) ?? []
    const orphan = orphanByOrder.get(ret.orderId) ?? []

    const allWh = new Set<string>()
    for (const m of [...scanner, ...inspect, ...orphan]) allWh.add(m.warehouseId)

    analyses.push({
      returnNumber: ret.returnNumber ?? '(no number)',
      returnId: ret.id,
      orderNumber: ret.order?.orderNumber ?? '?',
      status: ret.status,
      createdAt: ret.createdAt,
      receivedAt: ret.receivedAt,
      inspectedAt: ret.inspectedAt,
      scannerMovements: scanner,
      inspectMovements: inspect,
      orphanMovements: orphan,
      scannerCount: scanner.length,
      inspectCount: inspect.length,
      orphanCount: orphan.length,
      totalMovements: scanner.length + inspect.length + orphan.length,
      sameWarehouse: allWh.size === 0 ? null : allWh.size === 1,
      totalScannerQty: scanner.reduce((s, m) => s + m.quantity, 0),
      totalInspectQty: inspect.reduce((s, m) => s + m.quantity, 0),
    })
  }

  // ── 5. Bucket summary ──
  console.log('─────────────────────────────────────────────────────────────')
  console.log('  1. BUCKET SUMMARY — Retouren × Movement-Count')
  console.log('─────────────────────────────────────────────────────────────\n')

  const buckets = {
    zero: analyses.filter((a) => a.totalMovements === 0),
    onlyScanner: analyses.filter((a) => a.scannerCount > 0 && a.inspectCount === 0 && a.orphanCount === 0),
    onlyInspect: analyses.filter((a) => a.scannerCount === 0 && a.inspectCount > 0 && a.orphanCount === 0),
    onlyOrphan: analyses.filter((a) => a.scannerCount === 0 && a.inspectCount === 0 && a.orphanCount > 0),
    scannerAndInspect: analyses.filter((a) => a.scannerCount > 0 && a.inspectCount > 0),
    scannerAndOrphan: analyses.filter((a) => a.scannerCount > 0 && a.orphanCount > 0 && a.inspectCount === 0),
    inspectAndOrphan: analyses.filter((a) => a.inspectCount > 0 && a.orphanCount > 0 && a.scannerCount === 0),
    allThree: analyses.filter((a) => a.scannerCount > 0 && a.inspectCount > 0 && a.orphanCount > 0),
  }

  console.log(`  Keine Movements (status=requested/label_sent/rejected/etc): ${buckets.zero.length}`)
  console.log(`  NUR Scanner-Movement (${'Return scan:'}): ................ ${buckets.onlyScanner.length}`)
  console.log(`  NUR Inspect-Movement (${'Return restock:'}): .............. ${buckets.onlyInspect.length}`)
  console.log(`  NUR Orphan-Movement (referenceId=orderId, no label): ..... ${buckets.onlyOrphan.length}`)
  console.log(`  🚨 Scanner + Inspect (DOUBLE-RESTOCK): ................... ${buckets.scannerAndInspect.length}`)
  console.log(`  ⚠️  Scanner + Orphan: .................................... ${buckets.scannerAndOrphan.length}`)
  console.log(`  ⚠️  Inspect + Orphan: .................................... ${buckets.inspectAndOrphan.length}`)
  console.log(`  🚨 All three paths: ...................................... ${buckets.allThree.length}`)

  // ── 6. Concrete examples ──
  console.log('\n─────────────────────────────────────────────────────────────')
  console.log('  2. BEISPIELE — Konkrete Entity-IDs pro Kategorie')
  console.log('─────────────────────────────────────────────────────────────\n')

  function showExample(label: string, row: ReturnAnalysis) {
    console.log(`  ${label}`)
    console.log(`    Return: ${row.returnNumber} (id=${row.returnId.slice(0, 8)}…)`)
    console.log(`    Order: ${row.orderNumber}  Status: ${row.status}`)
    console.log(`    Created: ${row.createdAt.toISOString()}  Received: ${row.receivedAt?.toISOString() ?? '—'}  Inspected: ${row.inspectedAt?.toISOString() ?? '—'}`)
    console.log(`    Totals: scanner=${row.scannerCount}(${row.totalScannerQty} units)  inspect=${row.inspectCount}(${row.totalInspectQty} units)  orphan=${row.orphanCount}`)
    for (const m of row.scannerMovements) {
      console.log(`      · SCANNER  ${m.createdAt.toISOString()}  ${m.sku} +${m.quantity} @ ${m.warehouseName}`)
    }
    for (const m of row.inspectMovements) {
      console.log(`      · INSPECT  ${m.createdAt.toISOString()}  ${m.sku} +${m.quantity} @ ${m.warehouseName}`)
    }
    for (const m of row.orphanMovements) {
      console.log(`      · ORPHAN   ${m.createdAt.toISOString()}  ${m.sku} +${m.quantity} @ ${m.warehouseName}  ref=${m.referenceId}`)
    }
    console.log('')
  }

  if (buckets.onlyScanner.length > 0) showExample('▸ NUR Scanner (erwartet bei status=received ohne Inspect-Click):', buckets.onlyScanner[0])
  if (buckets.onlyInspect.length > 0) showExample('▸ NUR Inspect (erwartet bei Inspect-without-Scanner):', buckets.onlyInspect[0])
  if (buckets.onlyOrphan.length > 0) showExample('▸ NUR Orphan (Legacy-Movement ohne notes-Label):', buckets.onlyOrphan[0])

  if (buckets.scannerAndInspect.length > 0) {
    console.log('  🚨 DOUBLE-RESTOCK SAMPLES:')
    const n = Math.min(3, buckets.scannerAndInspect.length)
    for (let i = 0; i < n; i++) showExample(`   Sample ${i + 1}/${n}:`, buckets.scannerAndInspect[i])
  }

  // ── 7. Warehouse consistency ──
  console.log('─────────────────────────────────────────────────────────────')
  console.log('  3. WAREHOUSE-KONSISTENZ bei Double-Movements')
  console.log('─────────────────────────────────────────────────────────────\n')

  const doubles = buckets.scannerAndInspect
  const sameWh = doubles.filter((d) => d.sameWarehouse === true)
  const diffWh = doubles.filter((d) => d.sameWarehouse === false)
  console.log(`  Double-Restocks total:                    ${doubles.length}`)
  console.log(`  · Both movements at SAME warehouse:       ${sameWh.length}  (→ reiner quantity-Drift)`)
  console.log(`  · Movements at DIFFERENT warehouses:      ${diffWh.length}  (→ quantity-Drift + Warehouse-Drift)`)

  if (diffWh.length > 0) {
    console.log('\n  Different-Warehouse-Examples:')
    const n = Math.min(3, diffWh.length)
    for (let i = 0; i < n; i++) showExample(`   Sample ${i + 1}/${n}:`, diffWh[i])
  }

  // ── 8. Drift aggregation ──
  console.log('─────────────────────────────────────────────────────────────')
  console.log('  4. DRIFT-AGGREGATION — wie viele Phantom-Units systemweit?')
  console.log('─────────────────────────────────────────────────────────────\n')

  // Phantom units = sum of min(scannerQty, inspectQty) across all double-restocks
  // because the SECOND restock (whichever fired later) is the phantom one.
  // The actual count depends on which flow "truly" represents physical stock —
  // conservative estimate: total inspect-qty for any return that also has scanner.
  let phantomScannerPlusInspect = 0
  let phantomByMin = 0
  for (const d of doubles) {
    phantomScannerPlusInspect += d.totalInspectQty // assume scanner is authoritative, inspect is the extra
    phantomByMin += Math.min(d.totalScannerQty, d.totalInspectQty)
  }
  console.log(`  If Scanner is authoritative → phantom units = sum(inspect): ${phantomScannerPlusInspect}`)
  console.log(`  If Inspect is authoritative → phantom units = sum(scanner): ${doubles.reduce((s, d) => s + d.totalScannerQty, 0)}`)
  console.log(`  Conservative estimate (min of the two per return):          ${phantomByMin}`)

  // ── 9. Counter vs movement-sum reality check (system-wide) ──
  console.log('\n─────────────────────────────────────────────────────────────')
  console.log('  5. SANITY: reserved-counter drift across ALL inventory')
  console.log('─────────────────────────────────────────────────────────────\n')

  const agg = await prisma.stockReservation.groupBy({
    by: ['variantId', 'warehouseId'],
    where: { status: 'RESERVED' },
    _sum: { quantity: true },
  })
  const actualMap = new Map<string, number>()
  for (const a of agg) actualMap.set(`${a.variantId}::${a.warehouseId}`, a._sum.quantity ?? 0)
  const allInv = await prisma.inventory.findMany({
    select: { id: true, variantId: true, warehouseId: true, quantityReserved: true, variant: { select: { sku: true } } },
  })
  const drifting = allInv.filter((i: any) => i.quantityReserved !== (actualMap.get(`${i.variantId}::${i.warehouseId}`) ?? 0))
  console.log(`  Inventory rows scanned: ${allInv.length}`)
  console.log(`  Drifting (reserved counter ≠ actual RESERVED sum): ${drifting.length}`)
  if (drifting.length > 0) {
    for (const d of drifting.slice(0, 5)) {
      console.log(`    ${d.variant?.sku ?? '?'}  counter=${d.quantityReserved}  actual=${actualMap.get(`${d.variantId}::${d.warehouseId}`) ?? 0}`)
    }
  }

  // ── 10. State-machine distribution ──
  console.log('\n─────────────────────────────────────────────────────────────')
  console.log('  6. STATE-MACHINE-VERTEILUNG — welche Status haben welche Pfade?')
  console.log('─────────────────────────────────────────────────────────────\n')

  const byStatus = new Map<string, { total: number; scanner: number; inspect: number; both: number }>()
  for (const a of analyses) {
    const b = byStatus.get(a.status) ?? { total: 0, scanner: 0, inspect: 0, both: 0 }
    b.total++
    if (a.scannerCount > 0) b.scanner++
    if (a.inspectCount > 0) b.inspect++
    if (a.scannerCount > 0 && a.inspectCount > 0) b.both++
    byStatus.set(a.status, b)
  }
  console.log('  Status            total   hasScanner   hasInspect   BOTH')
  for (const [status, b] of byStatus.entries()) {
    console.log(`  ${status.padEnd(18)} ${String(b.total).padStart(4)}    ${String(b.scanner).padStart(4)}         ${String(b.inspect).padStart(4)}       ${String(b.both).padStart(4)}`)
  }

  // ── 11. Final verdict ──
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('  VERDICT')
  console.log('═══════════════════════════════════════════════════════════\n')

  if (buckets.scannerAndInspect.length === 0 && buckets.allThree.length === 0) {
    console.log('  ✅ NO double-restock in historical data.')
    console.log('     → The two flows are mutually exclusive in practice.')
    console.log('     → Verdict: R10 scope stays minimal (Option A).')
  } else {
    console.log(`  🚨 DOUBLE-RESTOCK CONFIRMED: ${buckets.scannerAndInspect.length + buckets.allThree.length} returns`)
    console.log(`     affected, estimated ${phantomByMin}–${phantomScannerPlusInspect} phantom units in onHand.`)
    console.log(`     → R10 scope needs guard (Option B or C).`)
  }
  console.log('\n')

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
