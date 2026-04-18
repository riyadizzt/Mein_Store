/**
 * Pre-launch full-data backup as JSON.
 *
 * We lack pg_dump locally, so we export every table that the reset will
 * touch (plus some that won't, for full rollback safety) into a single
 * JSON file. The companion `pre-launch-restore.ts` script can re-import
 * from this file if we ever need to roll back.
 *
 * No DB writes happen here — pure SELECT.
 */
import { PrismaClient } from '@prisma/client'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'

const prisma = new PrismaClient()

async function main() {
  const ts = new Date().toISOString().replace(/[:-]/g, '').replace(/\..+/, 'Z')
  const backupPath = `/tmp/malak-pre-launch-backup-${ts}.json`

  console.log(`\n═══ Pre-Launch Backup → ${backupPath} ═══\n`)
  const t0 = Date.now()

  const data: Record<string, any[]> = {}

  // Every table that will be mutated by the reset (delete or update).
  // Dump EVERYTHING so rollback can fully restore each table.
  const dumps: Array<[string, () => Promise<any[]>]> = [
    ['orders', () => prisma.order.findMany()],
    ['orderItems', () => prisma.orderItem.findMany()],
    ['orderStatusHistory', () => prisma.orderStatusHistory.findMany()],
    ['payments', () => prisma.payment.findMany()],
    ['refunds', () => prisma.refund.findMany()],
    ['invoices', () => prisma.invoice.findMany()],
    ['shipments', () => prisma.shipment.findMany()],
    ['returns', () => prisma.return.findMany()],
    ['stockReservations', () => prisma.stockReservation.findMany()],
    ['inventoryMovements', () => prisma.inventoryMovement.findMany()],
    ['notifications', () => prisma.notification.findMany()],
    ['adminAuditLogs', () => prisma.adminAuditLog.findMany()],
    ['emailLogs', () => prisma.emailLog.findMany()],
    ['searchLogs', () => prisma.searchLog.findMany()],
    ['adminNotes', () => prisma.adminNote.findMany()],
    ['webhookDeliveryLogs', () => prisma.webhookDeliveryLog.findMany()],
    ['whatsappMessages', () => prisma.whatsappMessage.findMany()],
    ['contactMessages', () => prisma.contactMessage.findMany()],
    ['idempotencyKeys', () => prisma.idempotencyKey.findMany()],
    ['refreshTokens', () => prisma.refreshToken.findMany()],
    ['addresses', () => prisma.address.findMany()],
    ['users', () => prisma.user.findMany()],
    ['productReviews', () => prisma.productReview.findMany()],
    ['wishlistItems', () => prisma.wishlistItem.findMany()],
    ['couponUsages', () => prisma.couponUsage.findMany()],
    // Sequences
    ['invoiceSequences', () => prisma.invoiceSequence.findMany()],
    ['orderSequences', () => prisma.orderSequence.findMany()],
    ['returnSequences', () => prisma.returnSequence.findMany()],
    // Products (for isActive rollback) + inventory (for quantity rollback)
    ['products', () => prisma.product.findMany()],
    ['inventory', () => prisma.inventory.findMany()],
  ]

  for (const [name, fn] of dumps) {
    try {
      const rows = await fn()
      data[name] = rows
      console.log(`  ✓ ${name.padEnd(24)} ${String(rows.length).padStart(8)} rows`)
    } catch (e: any) {
      console.log(`  ✗ ${name.padEnd(24)} ERROR: ${e.message.slice(0, 80)}`)
      data[name] = []
    }
  }

  // Custom JSON replacer — Prisma returns Decimal and Date types that
  // JSON.stringify can't handle natively. Decimal → string, Date → ISO.
  const json = JSON.stringify(data, (_, v) => {
    if (v === null || v === undefined) return v
    if (typeof v === 'bigint') return v.toString()
    if (v && typeof v === 'object' && typeof (v as any).toFixed === 'function' && 'd' in (v as any)) {
      // Prisma Decimal
      return (v as any).toString()
    }
    return v
  }, 2)

  writeFileSync(backupPath, json, 'utf8')
  const size = Buffer.byteLength(json, 'utf8')
  const tMs = Date.now() - t0

  console.log(`\n  ═══ DONE ═══`)
  console.log(`  file:   ${backupPath}`)
  console.log(`  size:   ${(size / 1024 / 1024).toFixed(2)} MB`)
  console.log(`  rows:   ${Object.values(data).reduce((s, r) => s + r.length, 0)}`)
  console.log(`  time:   ${(tMs / 1000).toFixed(1)}s`)
  console.log(`\n  Rollback:  npx tsx scripts/pre-launch-restore.ts ${backupPath}\n`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
