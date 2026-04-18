/**
 * Pre-launch test-data reset. ONE Prisma transaction — either all succeeds
 * or the DB stays untouched. Requires a recent backup (see pre-launch-
 * backup.ts) for safety; restore is a single `pre-launch-restore.ts` run.
 *
 * Phases (executed atomically):
 *   1. Disable GoBD triggers on invoices (allow delete)
 *   2. Delete all transactional data (orders, payments, etc.)
 *   3. Delete customer users (keep admin/warehouse/super_admin)
 *   4. Delete all session/refresh tokens (all admins must re-login)
 *   5. Reset invoice_sequences / order_sequences / return_sequences to 0
 *   6. Product cleanup: products-without-images → isActive=false
 *   7. Inventory reset:
 *      - ALL rows: quantityReserved = 0
 *      - Non-default warehouses: quantityOnHand = 0
 *      - Default warehouse: upsert 10 units per active variant
 *   8. Re-enable GoBD triggers
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('\n═══ Pre-Launch Reset ═══\n')

  // Verify backup exists before touching anything
  const fs = require('node:fs')
  const backups = fs.readdirSync('/tmp').filter((f: string) => f.startsWith('malak-pre-launch-backup-'))
  if (backups.length === 0) {
    throw new Error('ABORT — no backup file found in /tmp. Run pre-launch-backup.ts first.')
  }
  const latest = backups.sort().reverse()[0]
  const stat = fs.statSync(`/tmp/${latest}`)
  console.log(`  Backup: /tmp/${latest}  (${(stat.size / 1024 / 1024).toFixed(2)} MB)\n`)

  // Preload: default warehouse + active-variant list (readonly, outside tx)
  const defaultWh = await prisma.warehouse.findFirst({ where: { isDefault: true, isActive: true } })
  if (!defaultWh) throw new Error('ABORT — no default warehouse found')
  console.log(`  Default warehouse: ${defaultWh.name} (${defaultWh.id})\n`)

  const activeVariants = await prisma.productVariant.findMany({
    where: { isActive: true, product: { deletedAt: null } },
    select: { id: true },
  })
  console.log(`  Active variants to seed: ${activeVariants.length}\n`)

  const productsWithoutImages = await prisma.product.findMany({
    where: { images: { none: {} }, deletedAt: null, isActive: true },
    select: { id: true, slug: true },
  })
  console.log(`  Products to deactivate (no images): ${productsWithoutImages.length}`)
  for (const p of productsWithoutImages) console.log(`    - ${p.slug}`)
  console.log()

  const t0 = Date.now()

  // Single transaction — all-or-nothing. 60s timeout allows for the big
  // deletes + the per-variant upsert loop on ~546 rows.
  await prisma.$transaction(async (tx) => {
    console.log('  ─── Phase 1: Disable GoBD triggers ───')
    await tx.$executeRawUnsafe(`ALTER TABLE invoices DISABLE TRIGGER invoices_immutable_delete`)
    await tx.$executeRawUnsafe(`ALTER TABLE invoices DISABLE TRIGGER invoices_immutable_update`)
    console.log('    ✓ triggers disabled')

    console.log('  ─── Phase 2: Delete transactional data ───')
    const d: Record<string, number> = {}
    d.inventoryMovements = (await tx.inventoryMovement.deleteMany({})).count
    d.refunds = (await tx.refund.deleteMany({})).count
    d.invoices = (await tx.invoice.deleteMany({})).count

    // Returns are parents of return_items. Delete children first.
    d.returns = (await tx.return.deleteMany({})).count
    d.shipments = (await tx.shipment.deleteMany({})).count
    d.payments = (await tx.payment.deleteMany({})).count
    d.couponUsages = (await tx.couponUsage.deleteMany({})).count
    d.orderStatusHistory = (await tx.orderStatusHistory.deleteMany({})).count
    d.orderItems = (await tx.orderItem.deleteMany({})).count
    d.stockReservations = (await tx.stockReservation.deleteMany({})).count
    d.orders = (await tx.order.deleteMany({})).count
    d.productReviews = (await tx.productReview.deleteMany({})).count
    d.wishlistItems = (await tx.wishlistItem.deleteMany({})).count
    d.adminNotes = (await tx.adminNote.deleteMany({})).count
    d.notifications = (await tx.notification.deleteMany({})).count
    d.adminAuditLogs = (await tx.adminAuditLog.deleteMany({})).count
    d.emailLogs = (await tx.emailLog.deleteMany({})).count
    d.searchLogs = (await tx.searchLog.deleteMany({})).count
    d.webhookDeliveryLogs = (await tx.webhookDeliveryLog.deleteMany({})).count
    d.whatsappMessages = (await tx.whatsappMessage.deleteMany({})).count
    d.contactMessages = (await tx.contactMessage.deleteMany({})).count
    d.idempotencyKeys = (await tx.idempotencyKey.deleteMany({})).count
    d.refreshTokens = (await tx.refreshToken.deleteMany({})).count
    d.addresses = (await tx.address.deleteMany({})).count
    for (const [k, v] of Object.entries(d)) console.log(`    - ${k.padEnd(24)} ${String(v).padStart(6)} deleted`)

    console.log('  ─── Phase 3: Delete customer users ───')
    const deletedUsers = await tx.user.deleteMany({ where: { role: 'customer' } })
    console.log(`    - users (role=customer)       ${deletedUsers.count} deleted`)

    console.log('  ─── Phase 4: Reset sequences ───')
    await tx.invoiceSequence.deleteMany({})
    await tx.orderSequence.deleteMany({})
    await tx.returnSequence.deleteMany({})
    console.log('    ✓ invoice/order/return sequences cleared')

    console.log('  ─── Phase 5: Product cleanup (no-images → inactive) ───')
    const deactivated = await tx.product.updateMany({
      where: { id: { in: productsWithoutImages.map((p) => p.id) } },
      data: { isActive: false, updatedAt: new Date() },
    })
    console.log(`    - products deactivated        ${deactivated.count}`)

    console.log('  ─── Phase 6: Inventory reset ───')
    // 6a. Zero out reserved-counter on every row
    const zeroedRes = await tx.inventory.updateMany({ data: { quantityReserved: 0 } })
    console.log(`    - rows with reserved=0:      ${zeroedRes.count}`)

    // 6b. Non-default warehouses: onHand = 0
    const nonDefaultZeroed = await tx.inventory.updateMany({
      where: { warehouseId: { not: defaultWh.id } },
      data: { quantityOnHand: 0 },
    })
    console.log(`    - non-default WH zeroed:     ${nonDefaultZeroed.count}`)

    // 6c. Default warehouse: upsert 10 units per active variant
    let seeded = 0
    for (const v of activeVariants) {
      await tx.inventory.upsert({
        where: { variantId_warehouseId: { variantId: v.id, warehouseId: defaultWh.id } },
        update: { quantityOnHand: 10, quantityReserved: 0 },
        create: { variantId: v.id, warehouseId: defaultWh.id, quantityOnHand: 10, quantityReserved: 0, reorderPoint: 0 },
      })
      seeded++
    }
    console.log(`    - default WH seeded 10 each:  ${seeded}`)

    console.log('  ─── Phase 7: Re-enable GoBD triggers ───')
    await tx.$executeRawUnsafe(`ALTER TABLE invoices ENABLE TRIGGER invoices_immutable_delete`)
    await tx.$executeRawUnsafe(`ALTER TABLE invoices ENABLE TRIGGER invoices_immutable_update`)
    console.log('    ✓ triggers re-enabled')
  }, { timeout: 120_000 })  // 2min timeout for the big run

  const tMs = Date.now() - t0
  console.log(`\n═══ COMPLETE (${(tMs / 1000).toFixed(1)}s) ═══\n`)

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('\n✗ ABORTED:', e.message)
  console.error('\nDB is in its ORIGINAL state — transaction rolled back.')
  console.error('Backup is still at /tmp/malak-pre-launch-backup-*.json if you want to verify.\n')
  await prisma.$disconnect()
  process.exit(1)
})
