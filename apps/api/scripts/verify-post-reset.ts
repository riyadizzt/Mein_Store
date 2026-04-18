/**
 * Post-reset verification. Every assertion must be green for launch go-ahead.
 *
 * Read-only — no writes.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface Check {
  name: string
  pass: boolean
  actual: any
  expected: any
}

const checks: Check[] = []

function expect(name: string, actual: any, expected: any) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  checks.push({ name, pass, actual, expected })
}

async function main() {
  console.log('\n═══ Post-Reset Verification ═══\n')

  // ── Counts that MUST be zero ──
  expect('orders', await prisma.order.count(), 0)
  expect('orderItems', await prisma.orderItem.count(), 0)
  expect('orderStatusHistory', await prisma.orderStatusHistory.count(), 0)
  expect('payments', await prisma.payment.count(), 0)
  expect('refunds', await prisma.refund.count(), 0)
  expect('invoices', await prisma.invoice.count(), 0)
  expect('shipments', await prisma.shipment.count(), 0)
  expect('returns', await prisma.return.count(), 0)
  expect('stockReservations', await prisma.stockReservation.count(), 0)
  expect('inventoryMovements', await prisma.inventoryMovement.count(), 0)
  expect('notifications', await prisma.notification.count(), 0)
  expect('adminAuditLogs', await prisma.adminAuditLog.count(), 0)
  expect('emailLogs', await prisma.emailLog.count(), 0)
  expect('searchLogs', await prisma.searchLog.count(), 0)
  expect('adminNotes', await prisma.adminNote.count(), 0)
  expect('webhookDeliveryLogs', await prisma.webhookDeliveryLog.count(), 0)
  expect('whatsappMessages', await prisma.whatsappMessage.count(), 0)
  expect('contactMessages', await prisma.contactMessage.count(), 0)
  expect('idempotencyKeys', await prisma.idempotencyKey.count(), 0)
  expect('refreshTokens', await prisma.refreshToken.count(), 0)
  expect('addresses', await prisma.address.count(), 0)
  expect('productReviews', await prisma.productReview.count(), 0)
  expect('wishlistItems', await prisma.wishlistItem.count(), 0)
  expect('couponUsages', await prisma.couponUsage.count(), 0)

  // ── Sequences empty ──
  expect('invoiceSequences (empty)', await prisma.invoiceSequence.count(), 0)
  expect('orderSequences (empty)', await prisma.orderSequence.count(), 0)
  expect('returnSequences (empty)', await prisma.returnSequence.count(), 0)

  // ── Customer users deleted, admin users kept ──
  const customers = await prisma.user.count({ where: { role: 'customer' } })
  const admins = await prisma.user.count({ where: { role: 'admin' } })
  const superAdmins = await prisma.user.count({ where: { role: 'super_admin' } })
  const warehouseStaff = await prisma.user.count({ where: { role: 'warehouse_staff' } })
  expect('users role=customer (deleted)', customers, 0)
  expect('users role=admin (preserved)', admins, 5)
  expect('users role=super_admin (preserved)', superAdmins, 1)
  expect('users role=warehouse_staff (preserved)', warehouseStaff, 2)
  expect('total users = 8 (admins only)', await prisma.user.count(), 8)

  // ── Products + categories + settings untouched ──
  expect('products (unchanged)', await prisma.product.count(), 120)
  expect('productVariants (unchanged)', await prisma.productVariant.count(), 579)
  expect('productImages (unchanged)', await prisma.productImage.count(), 129)
  expect('categories (unchanged)', await prisma.category.count(), 60)
  expect('warehouses (unchanged)', await prisma.warehouse.count(), 4)
  expect('shopSettings (unchanged)', await prisma.shopSetting.count(), 97)
  expect('coupons (unchanged)', await prisma.coupon.count(), 5)
  expect('promotions (unchanged)', await prisma.promotion.count(), 1)
  expect('webhookSubscriptions (unchanged)', await prisma.webhookSubscription.count(), 1)

  // ── Products without images are now isActive=false ──
  const stillActiveNoImages = await prisma.product.count({
    where: { images: { none: {} }, deletedAt: null, isActive: true },
  })
  expect('active products without images', stillActiveNoImages, 0)
  const deactivatedCount = await prisma.product.count({ where: { isActive: false, deletedAt: null } })
  // 8 newly deactivated + whatever was already inactive before. Just assert >= 8.
  checks.push({
    name: 'deactivated products >= 8',
    pass: deactivatedCount >= 8,
    actual: deactivatedCount,
    expected: '>= 8',
  })

  // ── Inventory: reserved=0 overall, default warehouse=10 per active variant ──
  const defaultWh = await prisma.warehouse.findFirst({ where: { isDefault: true } })
  if (!defaultWh) throw new Error('No default warehouse')

  const totalReserved = await prisma.inventory.aggregate({ _sum: { quantityReserved: true } })
  expect('total reserved across ALL rows = 0', Number(totalReserved._sum.quantityReserved ?? 0), 0)

  const nonDefaultOnHand = await prisma.inventory.aggregate({
    where: { warehouseId: { not: defaultWh.id } },
    _sum: { quantityOnHand: true },
  })
  expect('non-default WH onHand sum = 0', Number(nonDefaultOnHand._sum.quantityOnHand ?? 0), 0)

  const activeVariantIds = (await prisma.productVariant.findMany({
    where: { isActive: true, product: { deletedAt: null } },
    select: { id: true },
  })).map((v) => v.id)

  const defaultWhRows = await prisma.inventory.findMany({
    where: { warehouseId: defaultWh.id, variantId: { in: activeVariantIds } },
    select: { variantId: true, quantityOnHand: true, quantityReserved: true },
  })
  const all10 = defaultWhRows.every((r) => r.quantityOnHand === 10 && r.quantityReserved === 0)
  expect(`default WH rows for active variants: count`, defaultWhRows.length, activeVariantIds.length)
  expect(`default WH: ALL active variants have exactly 10/0`, all10, true)

  // ── GoBD triggers re-enabled? ──
  const triggers: any[] = (await prisma.$queryRaw`
    SELECT trigger_name, enabled
    FROM (
      SELECT t.tgname AS trigger_name,
             t.tgenabled != 'D' AS enabled
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relname = 'invoices' AND NOT t.tgisinternal
    ) x
    ORDER BY trigger_name
  `) as any
  const gobdTriggers = triggers.filter((t: any) => t.trigger_name.includes('immutable'))
  expect('GoBD triggers count = 2', gobdTriggers.length, 2)
  expect('GoBD triggers all enabled', gobdTriggers.every((t: any) => t.enabled), true)

  // ── Drift sanity: orderItem.orderId is NOT NULL in schema so any row is orphaned.
  // Simple count — since we deleted all orders, table should be empty.
  expect('drift: orderItems count', await prisma.orderItem.count(), 0)
  expect('drift: returns count', await prisma.return.count(), 0)

  // ── Print summary ──
  console.log('')
  let pass = 0, fail = 0
  for (const c of checks) {
    const marker = c.pass ? '✓' : '✗'
    if (c.pass) {
      console.log(`  ${marker} ${c.name.padEnd(50)} ${String(c.actual).padStart(10)}`)
      pass++
    } else {
      console.log(`  ${marker} ${c.name.padEnd(50)} got=${JSON.stringify(c.actual)}  expected=${JSON.stringify(c.expected)}`)
      fail++
    }
  }
  console.log(`\n  ═══ ${pass} pass / ${fail} fail ═══\n`)

  if (fail === 0) {
    console.log('  ✅ LAUNCH-READY: DB is in a pristine pre-launch state.\n')
    console.log('  Next order → ORD-YYYYMMDD-000001')
    console.log('  Next invoice → RE-2026-00001')
    console.log('  Next credit note → GS-2026-00001')
    console.log('  Next return → RET-2026-00001\n')
  } else {
    console.log('  ✗ FAILURES — review above.  Rollback available at /tmp/malak-pre-launch-backup-*.json\n')
  }

  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
