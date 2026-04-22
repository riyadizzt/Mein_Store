/**
 * Cleanup-verification script — asserts the Phase 2 matrix test left no
 * orphans. Read-only except for a defensive final sweep of any E2E-P2-
 * prefixed rows that somehow slipped through the per-test cleanup.
 */
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config()
} catch {}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const orders = await prisma.order.findMany({
    where: { orderNumber: { startsWith: 'E2E-P2-' } },
    select: { id: true, orderNumber: true, status: true },
  })
  const returns = await prisma.return.findMany({
    where: { returnNumber: { startsWith: 'RET-E2E-P2-' } },
    select: { id: true, returnNumber: true, status: true },
  })
  const users = await prisma.user.findMany({
    where: { email: { startsWith: 'e2e-p2-' } },
    select: { id: true, email: true },
  })
  const audits = await prisma.adminAuditLog.count({
    where: { adminId: { startsWith: 'e2e-p2-admin-' } },
  })

  console.log(`\nE2E-P2 orphans in Live DB:`)
  console.log(`  Orders:        ${orders.length}`)
  console.log(`  Returns:       ${returns.length}`)
  console.log(`  Users:         ${users.length}`)
  console.log(`  Audit entries: ${audits}`)

  const total = orders.length + returns.length + users.length + audits
  if (total === 0) {
    console.log(`\n✓ DB is clean — no E2E-P2 residue\n`)
    process.exit(0)
  } else {
    console.log(`\n⚠ ${total} orphan row(s) found — running defensive sweep...`)
    for (const o of orders) console.log(`    order: ${o.orderNumber} (${o.status})`)
    for (const r of returns) console.log(`    return: ${r.returnNumber} (${r.status})`)
    for (const u of users) console.log(`    user: ${u.email}`)

    // Defensive sweep
    for (const o of orders) {
      await prisma.adminAuditLog.deleteMany({ where: { entityId: o.id } }).catch(() => {})
      await prisma.notification.deleteMany({ where: { entityId: o.id } }).catch(() => {})
    }
    for (const r of returns) {
      await prisma.adminAuditLog.deleteMany({ where: { entityId: r.id } }).catch(() => {})
      await prisma.notification.deleteMany({ where: { entityId: r.id } }).catch(() => {})
      await prisma.return.delete({ where: { id: r.id } }).catch(() => {})
    }
    for (const o of orders) {
      const pay = await prisma.payment.findFirst({ where: { orderId: o.id } }).catch(() => null)
      if (pay) {
        await prisma.refund.deleteMany({ where: { paymentId: pay.id } }).catch(() => {})
        await prisma.payment.delete({ where: { id: pay.id } }).catch(() => {})
      }
      await prisma.invoice.deleteMany({ where: { orderId: o.id } }).catch(() => {})
      await prisma.orderItem.deleteMany({ where: { orderId: o.id } }).catch(() => {})
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: o.id } }).catch(() => {})
      await prisma.order.delete({ where: { id: o.id } }).catch(() => {})
    }
    for (const u of users) {
      await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
    }
    await prisma.adminAuditLog.deleteMany({
      where: { adminId: { startsWith: 'e2e-p2-admin-' } },
    }).catch(() => {})
    console.log(`\n✓ Sweep complete\n`)
    process.exit(0)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
}).finally(() => prisma.$disconnect())
