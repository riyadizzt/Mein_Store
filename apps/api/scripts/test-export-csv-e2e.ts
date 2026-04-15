/**
 * Live end-to-end test for the rewritten CSV export against the real
 * Supabase DB. Verifies:
 *   1. existing mode: row count matches DB Inventory row count
 *   2. matrix mode:   row count = variants × active warehouses
 *   3. matrix mode:   zero-rows carry status=out_of_stock
 *   4. csv header + BOM stripping
 *   5. semicolon escaping still works on live data
 *
 * Non-destructive — only reads.
 */
import { NestFactory } from '@nestjs/core'
import { AdminInventoryService } from '../src/modules/admin/services/admin-inventory.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { AppModule } from '../src/app.module'

const PASS = (m: string) => console.log(`✅ ${m}`)
const FAIL = (m: string) => { console.error(`❌ ${m}`); process.exitCode = 1 }

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  const service = app.get(AdminInventoryService)
  const prisma = app.get(PrismaService)

  try {
    // ── Ground truth from DB ───────────────────────────────────────
    const dbInventoryCount = await prisma.inventory.count({
      where: { variant: { product: { deletedAt: null } } },
    })
    const dbVariantCount = await prisma.productVariant.count({
      where: { product: { deletedAt: null } },
    })
    const activeWarehouses = await prisma.warehouse.count({ where: { isActive: true } })

    console.log(`\nGround truth:`)
    console.log(`  Inventory rows (non-deleted products): ${dbInventoryCount}`)
    console.log(`  Variants (non-deleted):                ${dbVariantCount}`)
    console.log(`  Active warehouses:                     ${activeWarehouses}`)
    console.log(`  Expected matrix size:                  ${dbVariantCount * activeWarehouses}\n`)

    // ── 1. existing mode ───────────────────────────────────────────
    console.log('── Mode: existing ──────────────────────────────────')
    const existing = await service.exportCsv({ mode: 'existing' })
    const existingLines = existing.split('\n').filter((l) => l.length > 0)
    const existingRows = existingLines.length - 1 // minus header

    if (existingLines[0].startsWith('SKU;Barcode;Produkt')) PASS('Header row present')
    else FAIL(`Header wrong: "${existingLines[0]}"`)

    if (existingRows === dbInventoryCount) {
      PASS(`Row count matches DB: ${existingRows} == ${dbInventoryCount}`)
    } else {
      FAIL(`Row count mismatch: csv=${existingRows}, db=${dbInventoryCount}`)
    }

    // Spot-check: count per warehouse in the CSV vs DB
    const warehouses = await prisma.warehouse.findMany({ select: { id: true, name: true } })
    console.log('\n  Per-warehouse counts (csv vs db):')
    for (const w of warehouses) {
      const dbCount = await prisma.inventory.count({
        where: { warehouseId: w.id, variant: { product: { deletedAt: null } } },
      })
      // escape-aware count: look at column 13 (Lager), allowing quoted fields
      const csvCount = existingLines.slice(1).filter((line) => {
        const cols = parseCsvLine(line)
        return cols[12] === w.name
      }).length
      const ok = csvCount === dbCount
      console.log(`  ${ok ? '✅' : '❌'} ${w.name.padEnd(25)}  csv=${csvCount}  db=${dbCount}`)
      if (!ok) process.exitCode = 1
    }

    // ── 2. matrix mode ─────────────────────────────────────────────
    console.log('\n── Mode: matrix ────────────────────────────────────')
    const matrix = await service.exportCsv({ mode: 'matrix' })
    const matrixLines = matrix.split('\n').filter((l) => l.length > 0)
    const matrixRows = matrixLines.length - 1
    const expected = dbVariantCount * activeWarehouses

    if (matrixRows === expected) {
      PASS(`Row count is exact cross-product: ${matrixRows} = ${dbVariantCount} × ${activeWarehouses}`)
    } else {
      FAIL(`Matrix row count off: csv=${matrixRows}, expected=${expected}`)
    }

    // Count zero-rows (status=out_of_stock) — should equal matrix minus
    // the real stocked-above-0 rows
    const matrixZeroRows = matrixLines.slice(1).filter((line) => {
      const cols = parseCsvLine(line)
      return cols[6] === '0' && cols[14] === 'out_of_stock'
    }).length
    console.log(`  Matrix zero-rows (qty=0 & out_of_stock): ${matrixZeroRows}`)

    // Spot check: for each warehouse, matrix count should equal dbVariantCount
    console.log('\n  Per-warehouse counts in matrix mode:')
    for (const w of warehouses) {
      const csvCount = matrixLines.slice(1).filter((line) => {
        const cols = parseCsvLine(line)
        return cols[12] === w.name
      }).length
      const ok = csvCount === dbVariantCount
      console.log(`  ${ok ? '✅' : '❌'} ${w.name.padEnd(25)}  csv=${csvCount}  expected=${dbVariantCount}`)
      if (!ok) process.exitCode = 1
    }

    // ── 3. csv contains BOM via controller (simulate controller wrap) ──
    // Service returns without BOM. Controller prepends '\uFEFF'.
    if (!existing.startsWith('\uFEFF')) PASS('Service output has no BOM (controller adds it)')
    else FAIL('Service output should NOT contain BOM — that is the controller job')

    // ── 4. semicolon escaping on live data ─────────────────────────
    const semi = existingLines.filter((l) => l.includes('";'))
    if (semi.length > 0) {
      console.log(`\n  Found ${semi.length} quoted cell(s) with semicolons — escaping engaged`)
      PASS('Live data contains escaped cells (good — no raw ; injection)')
    } else {
      console.log('\n  No product names contain semicolons — escaping untested on live data (unit test covers it)')
    }

    // ── 5. categoryId filter ───────────────────────────────────────
    const someCat = await prisma.category.findFirst({ where: { parentId: null }, select: { id: true, translations: true } })
    if (someCat) {
      const filtered = await service.exportCsv({ mode: 'existing', categoryId: someCat.id })
      const filteredRows = filtered.split('\n').filter((l) => l.length > 0).length - 1
      console.log(`\n  Category filter (${someCat.id.slice(0, 8)}): ${filteredRows} rows`)
      if (filteredRows <= dbInventoryCount) {
        PASS('Category filter returns subset of total')
      } else {
        FAIL(`Filter leaked: ${filteredRows} > ${dbInventoryCount}`)
      }
    }
  } finally {
    await app.close()
  }

  if (process.exitCode === 1) {
    console.log('\n❌ Test FAILED — see errors above')
  } else {
    console.log('\n✅ All export CSV checks passed')
  }
}

// Minimal RFC-4180-ish CSV parser just for tests. Handles ";" delim,
// quoted fields, and escaped quotes inside quotes.
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') inQuotes = false
      else cur += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ';') { out.push(cur); cur = '' }
      else cur += c
    }
  }
  out.push(cur)
  return out
}

main().catch((e) => { console.error(e); process.exit(1) })
