/**
 * Soft-delete the historical drift order ORD-20260415-000017.
 * Test data cleanup. Same pattern used for 010/011 earlier today.
 *
 * The order has an inconsistent state (status=cancelled + payment=captured)
 * from manual testing earlier — harmless now that the UI guard is in place,
 * but it would clutter pre-launch reports.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const ORDER_NUMBER = 'ORD-20260415-000017'

  const before = await prisma.order.findFirst({
    where: { orderNumber: ORDER_NUMBER },
    include: { payment: { select: { provider: true, status: true } } },
  })

  if (!before) {
    console.log(`❌ Order ${ORDER_NUMBER} not found`)
    await prisma.$disconnect()
    return
  }

  console.log(`\n── BEFORE ──\n`)
  console.log(`  id:          ${before.id}`)
  console.log(`  orderNumber: ${before.orderNumber}`)
  console.log(`  status:      ${before.status}`)
  console.log(`  payment:     ${before.payment?.provider}/${before.payment?.status}`)
  console.log(`  deletedAt:   ${before.deletedAt?.toISOString() ?? 'null'}`)

  if (before.deletedAt) {
    console.log('\nℹ  Already soft-deleted — nothing to do')
    await prisma.$disconnect()
    return
  }

  const updated = await prisma.order.update({
    where: { id: before.id },
    data: { deletedAt: new Date() },
    select: { deletedAt: true },
  })

  console.log(`\n── AFTER ──\n`)
  console.log(`  deletedAt: ${updated.deletedAt?.toISOString()}`)
  console.log(`\n✅ Soft-deleted. Order stays in DB for audit trail but is hidden from admin lists and reports.`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
