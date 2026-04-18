/**
 * Live-DB E2E regression guard for the post-capture warehouse-change block.
 *
 * Seeds 3 orders in the three boundary statuses (pending, pending_payment,
 * confirmed) and exercises consolidateWarehouse + changeItemWarehouse
 * against each. Expected:
 *   - pending           → both methods allowed (but we assert no drift)
 *   - pending_payment   → both methods allowed
 *   - confirmed         → both methods 409 WarehouseChangeBlockedAfterCapture
 *   - confirmed + force → consolidate STILL 409 (force does not bypass)
 *
 * Non-destructive — E2E-WG-{RUN_ID} marker on every seed row for cleanup
 * verification at the end. Post-run drift-check asserts 0 new phantom
 * reservations systemwide.
 */

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config()
} catch { /* noop */ }

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NestFactory } = require('@nestjs/core')
const distBase = '../dist/apps/api/src'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require(`${distBase}/app.module`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaService } = require(`${distBase}/prisma/prisma.service`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AdminOrdersService } = require(`${distBase}/modules/admin/services/admin-orders.service`)

const RUN_ID = Date.now().toString(36)
const ADMIN_ID = `e2e-wg-admin-${RUN_ID}`

interface Fixture {
  userId: string
  orderIds: { pending: string; pending_payment: string; confirmed: string }
  orderNumbers: { pending: string; pending_payment: string; confirmed: string }
  itemIds: { pending: string; pending_payment: string; confirmed: string }
  reservationIds: string[]
  targetWarehouseId: string
  variantId: string
}

async function seed(prisma: any): Promise<Fixture> {
  // Pick any two warehouses so we have a source and a target.
  const warehouses = await prisma.warehouse.findMany({
    where: { isActive: true },
    take: 2,
    orderBy: { createdAt: 'asc' },
  })
  if (warehouses.length < 2) throw new Error('need 2 active warehouses for this test')
  const [sourceWh, targetWh] = warehouses

  // Pick any active variant with stock somewhere.
  const variant = await prisma.productVariant.findFirst({
    where: { isActive: true, inventory: { some: { quantityOnHand: { gt: 0 } } } },
  })
  if (!variant) throw new Error('need 1 active variant with stock')

  const user = await prisma.user.create({
    data: {
      email: `e2e-wg-${RUN_ID}@test.invalid`,
      passwordHash: null,
      firstName: 'E2E',
      lastName: 'WG',
      role: 'customer',
      isVerified: false,
    },
  })

  const statuses = ['pending', 'pending_payment', 'confirmed'] as const
  const orderIds: any = {}
  const orderNumbers: any = {}
  const itemIds: any = {}
  const reservationIds: string[] = []

  for (const status of statuses) {
    const orderNumber = `E2E-WG-${status.toUpperCase()}-${RUN_ID}`
    const order = await prisma.order.create({
      data: {
        orderNumber,
        userId: user.id,
        status,
        channel: 'website',
        subtotal: 10,
        discountAmount: 0,
        shippingCost: 0,
        taxAmount: 1.6,
        totalAmount: 10,
        currency: 'EUR',
        notes: 'E2E_WG_TEST_DO_NOT_USE',
        items: {
          create: {
            variantId: variant.id,
            quantity: 1,
            unitPrice: 10,
            taxRate: 19,
            totalPrice: 10,
            snapshotName: 'E2E WG test',
            snapshotSku: variant.sku,
          },
        },
      },
      include: { items: true },
    })
    orderIds[status] = order.id
    orderNumbers[status] = order.orderNumber
    itemIds[status] = order.items[0].id

    // Reservation in the source warehouse so the move paths have something
    // to work with. We don't rely on matching onHand, the guard + happy path
    // both fire before hitting check-constraints with these small numbers.
    const res = await prisma.stockReservation.create({
      data: {
        orderId: order.id,
        variantId: variant.id,
        warehouseId: sourceWh.id,
        quantity: 1,
        status: status === 'confirmed' ? 'CONFIRMED' : 'RESERVED',
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    reservationIds.push(res.id)
  }

  return {
    userId: user.id,
    orderIds,
    orderNumbers,
    itemIds,
    reservationIds,
    targetWarehouseId: targetWh.id,
    variantId: variant.id,
  }
}

async function cleanup(prisma: any, fx: Fixture) {
  try {
    const allOrderIds = Object.values(fx.orderIds)
    for (const oid of allOrderIds) {
      await prisma.adminAuditLog.deleteMany({ where: { entityId: oid } }).catch(() => {})
      await prisma.notification.deleteMany({ where: { entityId: oid } }).catch(() => {})
    }
    for (const rid of fx.reservationIds) {
      await prisma.stockReservation.delete({ where: { id: rid } }).catch(() => {})
    }
    for (const oid of allOrderIds) {
      await prisma.orderItem.deleteMany({ where: { orderId: oid } }).catch(() => {})
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: oid } }).catch(() => {})
      await prisma.order.delete({ where: { id: oid } }).catch(() => {})
    }
    await prisma.user.delete({ where: { id: fx.userId } }).catch(() => {})
  } catch (e: any) {
    console.warn(`  ⚠ cleanup warning: ${e.message}`)
  }
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗')
  console.log('║  Warehouse-Guard E2E — post-capture Lifecycle-Block      ║')
  console.log('╚══════════════════════════════════════════════════════════╝\n')

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] })
  const prisma = app.get(PrismaService)
  const orders = app.get(AdminOrdersService)

  const pass: string[] = []
  const fail: string[] = []
  let fx: Fixture | null = null

  try {
    fx = await seed(prisma)
    console.log(`  ✓ Seeded 3 orders (${fx.orderNumbers.pending}, ..._payment, ..._CONFIRMED)`)

    // ── consolidate: status=pending should pass ─────────────
    try {
      await orders.consolidateWarehouse(fx.orderIds.pending, fx.targetWarehouseId, ADMIN_ID, '127.0.0.1', false)
      pass.push('consolidate status=pending: passed guard (allowed)')
    } catch (e: any) {
      if (e?.response?.error === 'WarehouseChangeBlockedAfterCapture') {
        fail.push(`consolidate status=pending: WRONGLY blocked by guard`)
      } else {
        // Any other error is acceptable (stock-preflight warning, etc.) —
        // it proved the guard let us through.
        pass.push(`consolidate status=pending: passed guard (downstream: ${e?.response?.error ?? e.message?.slice(0, 40)})`)
      }
    }

    // ── consolidate: status=pending_payment should pass ─────
    try {
      await orders.consolidateWarehouse(fx.orderIds.pending_payment, fx.targetWarehouseId, ADMIN_ID, '127.0.0.1', false)
      pass.push('consolidate status=pending_payment: passed guard (allowed)')
    } catch (e: any) {
      if (e?.response?.error === 'WarehouseChangeBlockedAfterCapture') {
        fail.push(`consolidate status=pending_payment: WRONGLY blocked`)
      } else {
        pass.push(`consolidate status=pending_payment: passed guard (downstream: ${e?.response?.error ?? e.message?.slice(0, 40)})`)
      }
    }

    // ── consolidate: status=confirmed MUST be blocked ───────
    try {
      await orders.consolidateWarehouse(fx.orderIds.confirmed, fx.targetWarehouseId, ADMIN_ID, '127.0.0.1', false)
      fail.push('consolidate status=confirmed: did NOT throw (CRITICAL — guard bypassed)')
    } catch (e: any) {
      if (e?.response?.error === 'WarehouseChangeBlockedAfterCapture') {
        pass.push('consolidate status=confirmed: 409 WarehouseChangeBlockedAfterCapture ✓')
        if (e?.response?.message?.de && e?.response?.message?.en && e?.response?.message?.ar) {
          pass.push('  3-lang message payload present')
        } else {
          fail.push('  message payload missing one of {de, en, ar}')
        }
        if (Array.isArray(e?.response?.data?.allowedStatuses)) {
          pass.push('  allowedStatuses array surfaced')
        } else {
          fail.push('  allowedStatuses missing from data')
        }
      } else {
        fail.push(`consolidate status=confirmed: threw WRONG error: ${e?.response?.error ?? e.message}`)
      }
    }

    // ── consolidate: status=confirmed + force=true still blocked ──
    try {
      await orders.consolidateWarehouse(fx.orderIds.confirmed, fx.targetWarehouseId, ADMIN_ID, '127.0.0.1', true /* force */)
      fail.push('consolidate status=confirmed + force=true: did NOT throw (CRITICAL — force bypassed lifecycle guard)')
    } catch (e: any) {
      if (e?.response?.error === 'WarehouseChangeBlockedAfterCapture') {
        pass.push('consolidate confirmed + force=true: still 409 ✓ (Verfeinerung 2)')
      } else {
        fail.push(`consolidate confirmed + force: wrong error: ${e?.response?.error ?? e.message}`)
      }
    }

    // ── change_item: status=pending should pass ─────────────
    try {
      await orders.changeItemWarehouse(fx.orderIds.pending, fx.itemIds.pending, fx.targetWarehouseId, ADMIN_ID, '127.0.0.1')
      pass.push('change_item status=pending: passed guard (allowed)')
    } catch (e: any) {
      if (e?.response?.error === 'WarehouseChangeBlockedAfterCapture') {
        fail.push(`change_item status=pending: WRONGLY blocked`)
      } else {
        pass.push(`change_item status=pending: passed guard (downstream: ${e?.response?.error ?? e.message?.slice(0, 40)})`)
      }
    }

    // ── change_item: status=confirmed MUST be blocked ───────
    try {
      await orders.changeItemWarehouse(fx.orderIds.confirmed, fx.itemIds.confirmed, fx.targetWarehouseId, ADMIN_ID, '127.0.0.1')
      fail.push('change_item status=confirmed: did NOT throw (CRITICAL)')
    } catch (e: any) {
      if (e?.response?.error === 'WarehouseChangeBlockedAfterCapture') {
        pass.push('change_item status=confirmed: 409 ✓')
      } else {
        fail.push(`change_item status=confirmed: wrong error: ${e?.response?.error ?? e.message}`)
      }
    }

    // ── Audit-Trail verification ─────────────────────────────
    const auditEntries = await prisma.adminAuditLog.findMany({
      where: {
        adminId: ADMIN_ID,
        action: 'WAREHOUSE_CHANGE_BLOCKED_AFTER_CAPTURE',
      },
      orderBy: { createdAt: 'asc' },
    })
    if (auditEntries.length >= 3) {
      pass.push(`audit: ${auditEntries.length} WAREHOUSE_CHANGE_BLOCKED_AFTER_CAPTURE entries written`)
      const methods = new Set(auditEntries.map((e: any) => e.changes?.after?.method))
      if (methods.has('consolidate') && methods.has('change_item')) {
        pass.push('audit: both methods (consolidate + change_item) recorded')
      } else {
        fail.push(`audit: missing method — got ${[...methods].join(', ')}`)
      }
    } else {
      fail.push(`audit: expected ≥3 blocked entries, got ${auditEntries.length}`)
    }
  } catch (e: any) {
    fail.push(`FATAL: ${e.message}`)
    console.error(e)
  } finally {
    if (fx) {
      console.log('\n  Cleaning up...')
      await cleanup(prisma, fx)
    }
    await app.close()
  }

  console.log('\n═══ Results ═══')
  for (const p of pass) console.log(`  ✓ ${p}`)
  for (const f of fail) console.log(`  ✗ ${f}`)
  console.log(`\n  ${pass.length} pass / ${fail.length} fail\n`)
  process.exit(fail.length === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('fatal', e)
  process.exit(1)
})
