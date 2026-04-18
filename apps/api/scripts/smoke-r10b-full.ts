/**
 * Smoke test for R10-B full flow — Scanner + Inspect interaction.
 *
 * Verifies against Live Supabase that:
 *  1. Scanner +1, Inspect ok   → onHand +1 net (Dedup greift, kein zweiter Restock)
 *  2. Scanner +1, Inspect damaged → onHand ±0 (Decrement hebt Scanner auf)
 *  3. Inspect ok ohne Scanner  → onHand +1 (Fallback-Kette)
 *  4. Inspect damaged ohne Scanner → onHand ±0 (legacy doc-only)
 *
 * We bypass the Nest bootstrap and drive the DB directly, mirroring the
 * exact SQL sequence the service code produces. This is NOT a replacement
 * for the unit tests (they assert on service-layer semantics) — it's a
 * wire-level check that the persistence operations land as expected against
 * the real Postgres constraints and triggers.
 *
 * Non-destructive: creates fixtures, runs, cleans up. Zero residue.
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

async function assert(label: string, cond: boolean, detail?: string) {
  if (!cond) throw new Error(`FAIL ${label}: ${detail ?? ''}`)
  console.log(`  ✓ ${label}`)
}

/**
 * Simulates the Scanner-Flow (processReturnScan) on a specific variant.
 * Creates an inventoryMovement with the canonical 'Return scan:' prefix and
 * bumps quantityOnHand. Mirrors admin-inventory.service.ts:645-657 exactly.
 */
async function simulateScannerRestock(variantId: string, warehouseId: string, qty: number, returnNumber: string) {
  const inv = await prisma.inventory.findUnique({
    where: { variantId_warehouseId: { variantId, warehouseId } },
  })
  if (!inv) throw new Error(`No inventory row for variant=${variantId} warehouse=${warehouseId}`)
  await prisma.inventory.update({
    where: { id: inv.id },
    data: { quantityOnHand: { increment: qty } },
  })
  await prisma.inventoryMovement.create({
    data: {
      variantId,
      warehouseId,
      type: 'return_received',
      quantity: qty,
      quantityBefore: inv.quantityOnHand,
      quantityAfter: inv.quantityOnHand + qty,
      notes: `Return scan: ${returnNumber}`,
      createdBy: 'smoke',
    },
  })
}

/**
 * Simulates the Dedup-Guard + restockItem logic from admin-returns.service
 * for condition='ok'. Identical to the production branch.
 */
async function simulateInspectOk(variantId: string, warehouseId: string, qty: number, returnNumber: string, orderId: string) {
  // Dedup-Guard lookup
  const scannerAlreadyRestocked = await prisma.inventoryMovement.findFirst({
    where: {
      variantId,
      type: 'return_received',
      notes: { startsWith: `Return scan: ${returnNumber}` },
    },
    select: { id: true, warehouseId: true },
  })
  if (scannerAlreadyRestocked) {
    // Skip restock — scanner already did it
    return { skipped: true, scannerWarehouseId: scannerAlreadyRestocked.warehouseId }
  }
  // Normal restock path
  const inv = await prisma.inventory.findUnique({
    where: { variantId_warehouseId: { variantId, warehouseId } },
  })
  if (!inv) throw new Error('inventory row missing')
  await prisma.$transaction([
    prisma.inventory.update({
      where: { id: inv.id },
      data: { quantityOnHand: { increment: qty } },
    }),
    prisma.inventoryMovement.create({
      data: {
        variantId,
        warehouseId,
        type: 'return_received',
        quantity: qty,
        quantityBefore: inv.quantityOnHand,
        quantityAfter: inv.quantityOnHand + qty,
        referenceId: orderId,
        notes: `Return restock: ${returnNumber}`,
      },
    }),
  ])
  return { skipped: false }
}

/**
 * Simulates createDamagedMovement — scanner-aware damaged path.
 */
async function simulateInspectDamaged(variantId: string, qty: number, returnNumber: string, orderId: string) {
  const scannerMovement = await prisma.inventoryMovement.findFirst({
    where: {
      variantId,
      type: 'return_received',
      notes: { startsWith: `Return scan: ${returnNumber}` },
    },
    select: { warehouseId: true },
  })

  if (scannerMovement) {
    const inv = await prisma.inventory.findFirst({
      where: { variantId, warehouseId: scannerMovement.warehouseId },
    })
    if (!inv) return { decremented: false, warehouseId: scannerMovement.warehouseId }
    await prisma.$transaction([
      prisma.inventory.update({
        where: { id: inv.id },
        data: { quantityOnHand: { decrement: qty } },
      }),
      prisma.inventoryMovement.create({
        data: {
          variantId,
          warehouseId: inv.warehouseId,
          type: 'damaged',
          quantity: -qty,
          quantityBefore: inv.quantityOnHand,
          quantityAfter: inv.quantityOnHand - qty,
          referenceId: orderId,
          notes: `Damaged removal after scan: ${returnNumber}`,
        },
      }),
    ])
    return { decremented: true, warehouseId: inv.warehouseId }
  }

  // No scanner → doc-only
  const inv = await prisma.inventory.findFirst({
    where: { variantId },
    orderBy: { warehouse: { isDefault: 'desc' } },
  })
  if (!inv) return { decremented: false, warehouseId: null }
  await prisma.inventoryMovement.create({
    data: {
      variantId,
      warehouseId: inv.warehouseId,
      type: 'damaged',
      quantity: -qty,
      quantityBefore: inv.quantityOnHand,
      quantityAfter: inv.quantityOnHand,
      referenceId: orderId,
      notes: `Return damaged (no scan): ${returnNumber}`,
    },
  })
  return { decremented: false, warehouseId: inv.warehouseId }
}

async function main() {
  console.log('\n═══ R10-B SMOKE — Scanner + Inspect Interaction ═══\n')
  const cleanup: any = { variantIds: [], productId: null, orderIds: [] }

  try {
    // ── Seed ──
    const wh = await prisma.warehouse.findFirst({ where: { isActive: true } })
    const user = await prisma.user.findFirst({ where: { email: { contains: '@' } } })
    const cat = await prisma.category.findFirst()
    if (!wh || !user || !cat) throw new Error('need warehouse+user+category')

    const product = await prisma.product.create({
      data: {
        slug: `smoke-r10b-${Date.now()}`,
        brand: 'SMOKE',
        basePrice: 1,
        taxRate: 19,
        isActive: true,
        categoryId: cat.id,
      },
    })
    cleanup.productId = product.id

    const v = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `SMK-R10B-${Date.now()}`,
        barcode: `SMK-R10B-${Date.now()}`,
        color: 'X',
        size: 'X',
        priceModifier: 0,
        isActive: true,
      },
    })
    cleanup.variantIds.push(v.id)

    await prisma.inventory.create({
      data: { variantId: v.id, warehouseId: wh.id, quantityOnHand: 10, quantityReserved: 0, reorderPoint: 0 },
    })

    console.log(`  Seeded: variant=${v.sku} onHand=10 @ ${wh.name}\n`)

    // ── Szenario 1: Scanner +2, Inspect ok → +2 net, Dedup skipped restock ──
    console.log('  Szenario 1: Scanner +2, Inspect ok')
    const RN1 = 'RET-SMOKE-001'
    await simulateScannerRestock(v.id, wh.id, 2, RN1)
    const after1a = await prisma.inventory.findUnique({ where: { variantId_warehouseId: { variantId: v.id, warehouseId: wh.id } } })
    await assert('1.1 Scanner bumped onHand 10→12', after1a.quantityOnHand === 12, `actual=${after1a.quantityOnHand}`)

    const r1 = await simulateInspectOk(v.id, wh.id, 2, RN1, 'order-smoke-1')
    await assert('1.2 Inspect ok → Dedup skipped', r1.skipped === true)

    const after1b = await prisma.inventory.findUnique({ where: { variantId_warehouseId: { variantId: v.id, warehouseId: wh.id } } })
    await assert('1.3 onHand UNCHANGED after Inspect ok (no double-restock)', after1b.quantityOnHand === 12, `actual=${after1b.quantityOnHand}`)

    // Reset for next scenario
    await prisma.inventoryMovement.deleteMany({ where: { variantId: v.id } })
    await prisma.inventory.update({
      where: { variantId_warehouseId: { variantId: v.id, warehouseId: wh.id } },
      data: { quantityOnHand: 10 },
    })

    // ── Szenario 2: Scanner +2, Inspect damaged → 0 net ──
    console.log('\n  Szenario 2: Scanner +2, Inspect damaged')
    const RN2 = 'RET-SMOKE-002'
    await simulateScannerRestock(v.id, wh.id, 2, RN2)
    const after2a = await prisma.inventory.findUnique({ where: { variantId_warehouseId: { variantId: v.id, warehouseId: wh.id } } })
    await assert('2.1 Scanner bumped onHand 10→12', after2a.quantityOnHand === 12)

    const r2 = await simulateInspectDamaged(v.id, 2, RN2, 'order-smoke-2')
    await assert('2.2 Damaged decremented at scanner warehouse', r2.decremented === true && r2.warehouseId === wh.id)

    const after2b = await prisma.inventory.findUnique({ where: { variantId_warehouseId: { variantId: v.id, warehouseId: wh.id } } })
    await assert('2.3 onHand restored to BASELINE 10 (Scanner+2, Damaged-2)', after2b.quantityOnHand === 10, `actual=${after2b.quantityOnHand}`)

    // Reset
    await prisma.inventoryMovement.deleteMany({ where: { variantId: v.id } })
    await prisma.inventory.update({
      where: { variantId_warehouseId: { variantId: v.id, warehouseId: wh.id } },
      data: { quantityOnHand: 10 },
    })

    // ── Szenario 3: No Scanner, Inspect ok → +2 via fallback ──
    console.log('\n  Szenario 3: Kein Scanner, Inspect ok (legacy fallback)')
    const RN3 = 'RET-SMOKE-003'
    const r3 = await simulateInspectOk(v.id, wh.id, 2, RN3, 'order-smoke-3')
    await assert('3.1 Inspect ok → skipped=false (no scanner)', r3.skipped === false)

    const after3 = await prisma.inventory.findUnique({ where: { variantId_warehouseId: { variantId: v.id, warehouseId: wh.id } } })
    await assert('3.2 onHand +2 via fallback restock (10→12)', after3.quantityOnHand === 12, `actual=${after3.quantityOnHand}`)

    // Reset
    await prisma.inventoryMovement.deleteMany({ where: { variantId: v.id } })
    await prisma.inventory.update({
      where: { variantId_warehouseId: { variantId: v.id, warehouseId: wh.id } },
      data: { quantityOnHand: 10 },
    })

    // ── Szenario 4: No Scanner, Inspect damaged → doc-only ──
    console.log('\n  Szenario 4: Kein Scanner, Inspect damaged (doc-only)')
    const RN4 = 'RET-SMOKE-004'
    const r4 = await simulateInspectDamaged(v.id, 2, RN4, 'order-smoke-4')
    await assert('4.1 Damaged → decremented=false (no scanner → doc only)', r4.decremented === false)

    const after4 = await prisma.inventory.findUnique({ where: { variantId_warehouseId: { variantId: v.id, warehouseId: wh.id } } })
    await assert('4.2 onHand UNCHANGED at 10 (doc-only path)', after4.quantityOnHand === 10, `actual=${after4.quantityOnHand}`)

    // Movement notes should differentiate the paths
    const movements = await prisma.inventoryMovement.findMany({
      where: { variantId: v.id, type: 'damaged' },
      orderBy: { createdAt: 'asc' },
      select: { notes: true },
    })
    await assert('4.3 doc-only movement notes = "Return damaged (no scan): ..."', movements[0]?.notes?.includes('no scan') === true)

    console.log('\n═══ ALL 4 SZENARIEN PASSED ═══\n')
  } finally {
    console.log('═══ CLEANUP ═══')
    try {
      if (cleanup.variantIds.length) {
        for (const vid of cleanup.variantIds) {
          await prisma.inventoryMovement.deleteMany({ where: { variantId: vid } })
          await prisma.inventory.deleteMany({ where: { variantId: vid } })
          await prisma.productVariant.delete({ where: { id: vid } }).catch(() => {})
        }
      }
      if (cleanup.productId) {
        await prisma.product.delete({ where: { id: cleanup.productId } }).catch(() => {})
      }
      console.log('  ✓ cleanup complete\n')
    } catch (e: any) {
      console.warn('  ⚠ cleanup:', e.message)
    }
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
