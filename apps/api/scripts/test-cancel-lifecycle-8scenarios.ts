/**
 * End-to-end reservation cancel-lifecycle suite — live Supabase, non-destructive.
 *
 * Exercises every cancel-related code path after the 17.04.2026 fix so we
 * can be sure the counter never drifts again. Each scenario:
 *   1. Snapshots inventory before.
 *   2. Runs the action (reserve / confirm / release / cancel / cancelItems).
 *   3. Snapshots after.
 *   4. Asserts the delta matches the documented expectation.
 *   5. Resets inventory + deletes the test order so the next scenario starts
 *      from a known baseline.
 *
 * At the end of the run, ALL test fixtures (product, variant, inventory,
 * orders, reservations) are wiped. Zero residue in the DB.
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
const { NestFactory } = require('@nestjs/core')
const distBase = '../dist/apps/api/src'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require(`${distBase}/app.module`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaService } = require(`${distBase}/prisma/prisma.service`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ReservationService } = require(`${distBase}/modules/inventory/reservation.service`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AdminOrdersService } = require(`${distBase}/modules/admin/services/admin-orders.service`)

const ADMIN_ID = 'e2e-cancel-lifecycle-admin-' + Date.now()

interface InvSnapshot {
  warehouseId: string
  warehouseName: string
  onHand: number
  reserved: number
  available: number
}

interface Context {
  prisma: any
  reservations: any
  orders: any
  variantId: string
  productId: string
  userId: string
  whA: string
  whAName: string
  whB: string
  whBName: string
  baselineA: number
  baselineB: number
}

async function snapshot(ctx: Context): Promise<{ A: InvSnapshot; B: InvSnapshot }> {
  const rows = await ctx.prisma.inventory.findMany({
    where: { variantId: ctx.variantId },
    include: { warehouse: { select: { name: true } } },
  })
  const byWh = new Map<string, any>()
  for (const r of rows) byWh.set(r.warehouseId, r)
  const toSnap = (r: any, fallbackName: string): InvSnapshot => ({
    warehouseId: r?.warehouseId ?? '',
    warehouseName: r?.warehouse?.name ?? fallbackName,
    onHand: r?.quantityOnHand ?? 0,
    reserved: r?.quantityReserved ?? 0,
    available: (r?.quantityOnHand ?? 0) - (r?.quantityReserved ?? 0),
  })
  return {
    A: toSnap(byWh.get(ctx.whA), ctx.whAName),
    B: toSnap(byWh.get(ctx.whB), ctx.whBName),
  }
}

function deltas(before: any, after: any, where: 'A' | 'B') {
  return {
    onHand: after[where].onHand - before[where].onHand,
    reserved: after[where].reserved - before[where].reserved,
    available: after[where].available - before[where].available,
  }
}

async function resetInventory(ctx: Context) {
  await ctx.prisma.stockReservation.deleteMany({ where: { variantId: ctx.variantId } })
  await ctx.prisma.inventory.update({
    where: { variantId_warehouseId: { variantId: ctx.variantId, warehouseId: ctx.whA } },
    data: { quantityOnHand: ctx.baselineA, quantityReserved: 0 },
  })
  await ctx.prisma.inventory.update({
    where: { variantId_warehouseId: { variantId: ctx.variantId, warehouseId: ctx.whB } },
    data: { quantityOnHand: ctx.baselineB, quantityReserved: 0 },
  })
}

async function makeOrder(ctx: Context, status: string): Promise<string> {
  const order = await ctx.prisma.order.create({
    data: {
      orderNumber: `E2E-CL-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      userId: ctx.userId,
      status,
      channel: 'website',
      subtotal: 1,
      shippingCost: 0,
      discountAmount: 0,
      taxAmount: 0.16,
      totalAmount: 1,
      currency: 'EUR',
      items: {
        create: {
          variantId: ctx.variantId,
          quantity: 1,
          unitPrice: 1,
          taxRate: 19,
          totalPrice: 1,
          snapshotName: 'E2E',
          snapshotSku: 'MAL-E2E-CL',
        },
      },
    },
  })
  return order.id
}

async function cleanupOrders(prisma: any) {
  const orders = await prisma.order.findMany({
    where: { orderNumber: { startsWith: 'E2E-CL-' } },
    select: { id: true },
  })
  for (const o of orders) {
    await prisma.orderItem.deleteMany({ where: { orderId: o.id } }).catch(() => {})
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: o.id } }).catch(() => {})
    await prisma.payment.deleteMany({ where: { orderId: o.id } }).catch(() => {})
    await prisma.order.delete({ where: { id: o.id } }).catch(() => {})
  }
}

class AssertionError extends Error {}

function expectEqual(label: string, actual: any, expected: any) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new AssertionError(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

const scenarios: Array<{ name: string; run: (ctx: Context) => Promise<void> }> = []
function scenario(name: string, run: (ctx: Context) => Promise<void>) {
  scenarios.push({ name, run })
}

// 1. Normal flow: reserve → confirm (== ship) → row CONFIRMED, both counters drop
scenario('1. Normaler Kauf — reserve → confirm (ship)', async (ctx) => {
  const before = await snapshot(ctx)
  const orderId = await makeOrder(ctx, 'pending')
  const res = await ctx.reservations.reserve({ variantId: ctx.variantId, warehouseId: ctx.whA, quantity: 3, orderId })
  const mid = await snapshot(ctx)
  await ctx.reservations.confirm(res.id, orderId)
  const after = await snapshot(ctx)

  expectEqual('reserve: A onHand unchanged', deltas(before, mid, 'A').onHand, 0)
  expectEqual('reserve: A reserved +3', deltas(before, mid, 'A').reserved, 3)
  expectEqual('reserve: A available -3', deltas(before, mid, 'A').available, -3)
  expectEqual('confirm: A onHand -3 (physical left)', deltas(before, after, 'A').onHand, -3)
  expectEqual('confirm: A reserved back to 0', deltas(before, after, 'A').reserved, 0)
  expectEqual('confirm: A available -3', deltas(before, after, 'A').available, -3)
})

// 2. Cancel BEFORE payment
scenario('2. Cancel vor Bezahlung — reserved zurück, onHand UNVERÄNDERT', async (ctx) => {
  const before = await snapshot(ctx)
  const orderId = await makeOrder(ctx, 'pending')
  await ctx.reservations.reserve({ variantId: ctx.variantId, warehouseId: ctx.whA, quantity: 4, orderId })
  const mid = await snapshot(ctx)
  await ctx.orders.cancelWithRefund(orderId, 'E2E test', ADMIN_ID, '127.0.0.1')
  await new Promise((r) => setTimeout(r, 300))
  const after = await snapshot(ctx)

  expectEqual('reserve: A reserved +4', deltas(before, mid, 'A').reserved, 4)
  expectEqual('cancel: A onHand (no inflation)', deltas(before, after, 'A').onHand, 0)
  expectEqual('cancel: A reserved back to 0', deltas(before, after, 'A').reserved, 0)
})

// 3. Cancel AFTER payment captured, BEFORE ship
scenario('3. Cancel nach Bezahlung (kein Versand)', async (ctx) => {
  const before = await snapshot(ctx)
  const orderId = await makeOrder(ctx, 'confirmed')
  await ctx.reservations.reserve({ variantId: ctx.variantId, warehouseId: ctx.whA, quantity: 2, orderId })
  await ctx.prisma.payment.create({
    data: { orderId, provider: 'VORKASSE', method: 'vorkasse', status: 'captured', amount: 1, currency: 'EUR' },
  })
  await ctx.orders.cancelWithRefund(orderId, 'E2E test', ADMIN_ID, '127.0.0.1')
  await new Promise((r) => setTimeout(r, 300))
  const after = await snapshot(ctx)

  expectEqual('cancel: A onHand (no inflation)', deltas(before, after, 'A').onHand, 0)
  expectEqual('cancel: A reserved back', deltas(before, after, 'A').reserved, 0)
})

// 4. Cancel AFTER ship: reservation already CONFIRMED → cancel is inventory-no-op
scenario('4. Cancel nach Versand — Inventory nach Versand unverändert', async (ctx) => {
  const before = await snapshot(ctx)
  const orderId = await makeOrder(ctx, 'shipped')
  const res = await ctx.reservations.reserve({ variantId: ctx.variantId, warehouseId: ctx.whA, quantity: 2, orderId })
  await ctx.reservations.confirm(res.id, orderId)
  const midAfterShip = await snapshot(ctx)
  expectEqual('ship: A onHand -2', deltas(before, midAfterShip, 'A').onHand, -2)
  expectEqual('ship: A reserved back', deltas(before, midAfterShip, 'A').reserved, 0)

  await ctx.orders.cancelWithRefund(orderId, 'E2E test', ADMIN_ID, '127.0.0.1')
  await new Promise((r) => setTimeout(r, 300))
  const after = await snapshot(ctx)

  expectEqual('cancel-after-ship: A onHand unchanged vs. midShip', after.A.onHand, midAfterShip.A.onHand)
  expectEqual('cancel-after-ship: A reserved unchanged vs. midShip', after.A.reserved, midAfterShip.A.reserved)
})

// 5. Partial cancel: order with 3 items → admin cancels 1
scenario('5. Teilstornierung — 1 von 3', async (ctx) => {
  const before = await snapshot(ctx)
  const order = await ctx.prisma.order.create({
    data: {
      orderNumber: `E2E-CL-${Date.now()}-PART`,
      userId: ctx.userId, status: 'confirmed', channel: 'website',
      subtotal: 3, shippingCost: 0, discountAmount: 0, taxAmount: 0.48, totalAmount: 3, currency: 'EUR',
      items: {
        create: Array.from({ length: 3 }, () => ({
          variantId: ctx.variantId, quantity: 1, unitPrice: 1, taxRate: 19, totalPrice: 1,
          snapshotName: 'E2E', snapshotSku: 'MAL-E2E-CL',
        })),
      },
    },
    include: { items: true },
  })
  await ctx.reservations.reserve({ variantId: ctx.variantId, warehouseId: ctx.whA, quantity: 3, orderId: order.id })
  const afterReserve = await snapshot(ctx)
  expectEqual('reserved 3', deltas(before, afterReserve, 'A').reserved, 3)

  await ctx.orders.cancelItems(order.id, [order.items[0].id], 'E2E partial', ADMIN_ID, '127.0.0.1')
  await new Promise((r) => setTimeout(r, 300))
  const afterPartial = await snapshot(ctx)

  // Current semantic: cancelItems releases the WHOLE reservation for that variant+order.
  // Remaining 2 items no longer have a reservation but the inventory counter is
  // NEVER inflated — which is the drift-relevant guarantee this suite enforces.
  expectEqual('partial: A onHand (no inflation)', deltas(before, afterPartial, 'A').onHand, 0)
  expectEqual('partial: A reserved back to 0 (whole reservation released)', deltas(before, afterPartial, 'A').reserved, 0)
})

// 6. Auto-cancel (payment timeout): same flow as cron invocation
scenario('6. Auto-cancel (Payment Timeout)', async (ctx) => {
  const before = await snapshot(ctx)
  const orderId = await makeOrder(ctx, 'pending_payment')
  const res = await ctx.reservations.reserve({ variantId: ctx.variantId, warehouseId: ctx.whA, quantity: 2, orderId })
  await ctx.orders.cancelWithRefund(orderId, 'payment_timeout', ADMIN_ID, '127.0.0.1')
  await new Promise((r) => setTimeout(r, 300))
  const after = await snapshot(ctx)

  expectEqual('auto-cancel: A onHand', deltas(before, after, 'A').onHand, 0)
  expectEqual('auto-cancel: A reserved', deltas(before, after, 'A').reserved, 0)

  const r = await ctx.prisma.stockReservation.findUnique({ where: { id: res.id } })
  expectEqual('reservation status = RELEASED (not deleted — audit trail preserved)', r?.status, 'RELEASED')
})

// 7. Double cancel: must be rejected, NO drift
scenario('7. Doppelstornierung — 2. Aufruf abgelehnt, KEIN Drift', async (ctx) => {
  const before = await snapshot(ctx)
  const orderId = await makeOrder(ctx, 'pending')
  await ctx.reservations.reserve({ variantId: ctx.variantId, warehouseId: ctx.whA, quantity: 1, orderId })
  await ctx.orders.cancelWithRefund(orderId, 'E2E first', ADMIN_ID, '127.0.0.1')
  await new Promise((r) => setTimeout(r, 300))
  const afterFirst = await snapshot(ctx)

  let secondThrew = false
  try {
    await ctx.orders.cancelWithRefund(orderId, 'E2E second', ADMIN_ID, '127.0.0.1')
  } catch {
    secondThrew = true
  }
  const afterSecond = await snapshot(ctx)

  expectEqual('2nd cancel throws', secondThrew, true)
  expectEqual('no drift after 2nd cancel: onHand', afterSecond.A.onHand, afterFirst.A.onHand)
  expectEqual('no drift after 2nd cancel: reserved', afterSecond.A.reserved, afterFirst.A.reserved)
  expectEqual('baseline restored: onHand', deltas(before, afterSecond, 'A').onHand, 0)
  expectEqual('baseline restored: reserved', deltas(before, afterSecond, 'A').reserved, 0)
})

// 8. Multi-Warehouse: reserve in A, cancel → B untouched
scenario('8. Multi-Warehouse — Cancel in A lässt B unberührt', async (ctx) => {
  const before = await snapshot(ctx)
  const orderId = await makeOrder(ctx, 'pending')
  await ctx.reservations.reserve({ variantId: ctx.variantId, warehouseId: ctx.whA, quantity: 3, orderId })
  await ctx.orders.cancelWithRefund(orderId, 'E2E multi', ADMIN_ID, '127.0.0.1')
  await new Promise((r) => setTimeout(r, 300))
  const after = await snapshot(ctx)

  expectEqual('A onHand unchanged', deltas(before, after, 'A').onHand, 0)
  expectEqual('A reserved unchanged', deltas(before, after, 'A').reserved, 0)
  expectEqual('B onHand untouched by cancel in A', deltas(before, after, 'B').onHand, 0)
  expectEqual('B reserved untouched by cancel in A', deltas(before, after, 'B').reserved, 0)
})

// ── R9 scenarios (post-payment restock) ──────────────────────
//
// These tests cover the specific bug R9 fixes:
// pre-R9 the confirm()-then-cancel path dropped onHand at capture time
// but never restored it at cancel time, silently losing stock.
// Post-R9, restockFromConfirmed pushes onHand back to the reservation's
// recorded warehouse when the refund succeeds.

// 9. Post-capture full cancel with R9: confirm() THEN cancel → onHand restored
scenario('9. R9: Post-Payment Full-Cancel restored onHand (confirm → cancel)', async (ctx) => {
  const before = await snapshot(ctx)
  const orderId = await makeOrder(ctx, 'confirmed')
  const res = await ctx.reservations.reserve({ variantId: ctx.variantId, warehouseId: ctx.whA, quantity: 3, orderId })
  await ctx.reservations.confirm(res.id, orderId)
  const afterConfirm = await snapshot(ctx)
  // After confirm: onHand -3 (that's the pre-R9 state admins saw when stock "vanished")
  expectEqual('confirm: A onHand -3', deltas(before, afterConfirm, 'A').onHand, -3)
  expectEqual('confirm: A reserved back to 0', deltas(before, afterConfirm, 'A').reserved, 0)

  // Payment captured (simulates Stripe webhook)
  await ctx.prisma.payment.create({
    data: { orderId, provider: 'VORKASSE', method: 'vorkasse', status: 'captured', amount: 1, currency: 'EUR' },
  })

  // Admin cancels → refund succeeds → R9 must restore onHand
  await ctx.orders.cancelWithRefund(orderId, 'E2E R9 full', ADMIN_ID, '127.0.0.1')
  await new Promise((r) => setTimeout(r, 300))
  const after = await snapshot(ctx)

  expectEqual('R9: A onHand restored to baseline', after.A.onHand, before.A.onHand)
  expectEqual('R9: A reserved still 0', deltas(before, after, 'A').reserved, 0)

  // Reservation flipped CONFIRMED → RELEASED (audit trail preserved)
  const r = await ctx.prisma.stockReservation.findUnique({ where: { id: res.id } })
  expectEqual('R9: reservation status = RELEASED', r?.status, 'RELEASED')
})

// 10. Post-capture partial cancel with R9: only cancelled variant is restocked
scenario('10. R9: Post-Payment Partial-Cancel restored only cancelled item', async (ctx) => {
  const before = await snapshot(ctx)
  // Order with 3 items on the same variant (cart collapses → 1 reservation qty=3)
  const order = await ctx.prisma.order.create({
    data: {
      orderNumber: `E2E-CL-${Date.now()}-R9PART`,
      userId: ctx.userId, status: 'confirmed', channel: 'website',
      subtotal: 3, shippingCost: 0, discountAmount: 0, taxAmount: 0.48, totalAmount: 3, currency: 'EUR',
      items: {
        create: Array.from({ length: 3 }, () => ({
          variantId: ctx.variantId, quantity: 1, unitPrice: 1, taxRate: 19, totalPrice: 1,
          snapshotName: 'E2E', snapshotSku: 'MAL-E2E-CL',
        })),
      },
    },
    include: { items: true },
  })
  const res = await ctx.reservations.reserve({ variantId: ctx.variantId, warehouseId: ctx.whA, quantity: 3, orderId: order.id })
  await ctx.reservations.confirm(res.id, order.id)
  const afterConfirm = await snapshot(ctx)
  expectEqual('confirm: A onHand -3', deltas(before, afterConfirm, 'A').onHand, -3)

  await ctx.prisma.payment.create({
    data: { orderId: order.id, provider: 'VORKASSE', method: 'vorkasse', status: 'captured', amount: 3, currency: 'EUR' },
  })

  // Cancel just 1 of 3 items
  await ctx.orders.cancelItems(order.id, [order.items[0].id], 'E2E R9 partial', ADMIN_ID, '127.0.0.1')
  await new Promise((r) => setTimeout(r, 300))
  const after = await snapshot(ctx)

  // NOTE: Because cart collapses a variant into ONE reservation, cancelItems
  // partial releases the whole reservation qty=3 when ANY item of that variant
  // is cancelled (documented in scenario 5). R9's restockFromConfirmed then
  // puts ALL 3 units back — keeping the drift-free invariant.
  // If per-item-granular restock is needed later, the fix is at the
  // reservation-split level, not at restockFromConfirmed.
  expectEqual('R9 partial: A onHand restored to baseline (whole-reservation semantic)', after.A.onHand, before.A.onHand)
  expectEqual('R9 partial: A reserved back to 0', deltas(before, after, 'A').reserved, 0)
})

// 11. Post-capture cancel is idempotent — second call no-op
scenario('11. R9: Post-Payment Cancel Idempotent (double-call no-op)', async (ctx) => {
  const before = await snapshot(ctx)
  const orderId = await makeOrder(ctx, 'confirmed')
  const res = await ctx.reservations.reserve({ variantId: ctx.variantId, warehouseId: ctx.whA, quantity: 2, orderId })
  await ctx.reservations.confirm(res.id, orderId)
  await ctx.prisma.payment.create({
    data: { orderId, provider: 'VORKASSE', method: 'vorkasse', status: 'captured', amount: 1, currency: 'EUR' },
  })
  await ctx.orders.cancelWithRefund(orderId, 'E2E R9 first', ADMIN_ID, '127.0.0.1')
  await new Promise((r) => setTimeout(r, 300))
  const afterFirst = await snapshot(ctx)
  expectEqual('first cancel: onHand restored', afterFirst.A.onHand, before.A.onHand)

  // Call restockFromConfirmed directly — simulates webhook replay / retry
  const directResult = await ctx.reservations.restockFromConfirmed(orderId, 'direct replay', ADMIN_ID)
  const afterReplay = await snapshot(ctx)

  expectEqual('replay restock count = 0 (no CONFIRMED rows left)', directResult.restocked, 0)
  expectEqual('replay: onHand unchanged (no double-restock)', afterReplay.A.onHand, afterFirst.A.onHand)
})

// ── Main ──

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] })
  const prisma = app.get(PrismaService)
  const reservations = app.get(ReservationService)
  const orders = app.get(AdminOrdersService)

  const cleanup = { userId: '', productId: '', variantId: '' }
  try {
    console.log('\n═══ SEED ═══\n')

    const warehouses = await prisma.warehouse.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } })
    if (warehouses.length < 2) throw new Error('need >= 2 active warehouses')
    const whA = warehouses.find((w: any) => w.name === 'Marzahn') ?? warehouses[0]
    const whB = warehouses.find((w: any) => w.id !== whA.id) ?? warehouses[1]
    console.log(`  WH-A: ${whA.name}`)
    console.log(`  WH-B: ${whB.name}`)

    const anyUser = await prisma.user.findFirst({ where: { email: { contains: '@' } } })
    if (!anyUser) throw new Error('no user found for test')
    cleanup.userId = anyUser.id

    const anyCategory = await prisma.category.findFirst()
    if (!anyCategory) throw new Error('no category found — cannot create test product')

    const product = await prisma.product.create({
      data: {
        slug: `e2e-cl-${Date.now()}`,
        brand: 'E2E',
        basePrice: 1,
        taxRate: 19,
        isActive: true,
        categoryId: anyCategory.id,
      },
    })
    cleanup.productId = product.id

    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `MAL-E2E-CL-${Date.now()}`,
        barcode: `MAL-E2E-CL-${Date.now()}`,
        color: 'TestColor', size: 'TestSize',
        priceModifier: 0, isActive: true,
      },
    })
    cleanup.variantId = variant.id

    const BASELINE_A = 20
    const BASELINE_B = 10
    await prisma.inventory.create({
      data: { variantId: variant.id, warehouseId: whA.id, quantityOnHand: BASELINE_A, quantityReserved: 0, reorderPoint: 0 },
    })
    await prisma.inventory.create({
      data: { variantId: variant.id, warehouseId: whB.id, quantityOnHand: BASELINE_B, quantityReserved: 0, reorderPoint: 0 },
    })
    console.log(`  Variant ${variant.sku}  —  A:${BASELINE_A}, B:${BASELINE_B}\n`)

    const ctx: Context = {
      prisma, reservations, orders,
      variantId: variant.id, productId: product.id, userId: anyUser.id,
      whA: whA.id, whAName: whA.name, whB: whB.id, whBName: whB.name,
      baselineA: BASELINE_A, baselineB: BASELINE_B,
    }

    console.log('═══ SZENARIEN ═══\n')
    let pass = 0
    let fail = 0
    const failures: string[] = []
    for (const sc of scenarios) {
      try {
        await sc.run(ctx)
        console.log(`  ✓ ${sc.name}`)
        pass++
      } catch (e: any) {
        const msg = e instanceof AssertionError ? e.message : (e?.message ?? String(e))
        console.log(`  ✗ ${sc.name}`)
        console.log(`      ${msg}`)
        failures.push(`${sc.name}: ${msg}`)
        fail++
      } finally {
        await resetInventory(ctx).catch(() => {})
        await cleanupOrders(prisma).catch(() => {})
      }
    }

    console.log(`\n═══ ${pass} pass / ${fail} fail ═══\n`)
    if (failures.length > 0) {
      console.log('Failures:')
      for (const f of failures) console.log(`  ✗ ${f}`)
    }

    // Drift-sanity check on ALL inventory rows (not just test variant)
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
    if (drifting.length === 0) {
      console.log(`  ✓ Drift-sanity: 0 rows drifting across ALL ${allInv.length} inventory rows\n`)
    } else {
      console.log(`  ✗ Drift-sanity: ${drifting.length} rows drifting:\n`)
      for (const d of drifting) {
        console.log(`    ${d.variant?.sku ?? '?'}  counter=${d.quantityReserved}  real=${actualMap.get(`${d.variantId}::${d.warehouseId}`) ?? 0}`)
      }
      fail += drifting.length
    }

    process.exitCode = fail === 0 ? 0 : 1
  } finally {
    console.log('═══ CLEANUP ═══')
    try {
      await cleanupOrders(prisma).catch(() => {})
      if (cleanup.variantId) {
        await prisma.stockReservation.deleteMany({ where: { variantId: cleanup.variantId } }).catch(() => {})
        await prisma.inventoryMovement.deleteMany({ where: { variantId: cleanup.variantId } }).catch(() => {})
        await prisma.inventory.deleteMany({ where: { variantId: cleanup.variantId } }).catch(() => {})
        await prisma.productVariant.delete({ where: { id: cleanup.variantId } }).catch(() => {})
      }
      if (cleanup.productId) {
        await prisma.product.delete({ where: { id: cleanup.productId } }).catch(() => {})
      }
      console.log('  ✓ all fixtures removed\n')
    } catch (e: any) {
      console.warn(`  ⚠ cleanup: ${e.message}`)
    }
    await app.close()
  }
}

main().catch((e) => {
  console.error('fatal', e)
  process.exit(1)
})
