import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const total = await prisma.order.count()
  const unread = await prisma.order.count({ where: { firstViewedByAdminAt: null } })
  const withBackfill = await prisma.order.count({ where: { firstViewedByAdminAt: { not: null } } })
  console.log(`\n  Total: ${total}   Unread (badge-count): ${unread}   Backfilled: ${withBackfill}`)
  // Sample 3 orders to confirm backfill used created_at
  const samples = await prisma.order.findMany({ select: { orderNumber: true, createdAt: true, firstViewedByAdminAt: true, firstViewedByAdmin: true }, take: 3 })
  console.log()
  for (const s of samples) {
    const match = s.createdAt?.toISOString() === s.firstViewedByAdminAt?.toISOString()
    console.log(`  ${s.orderNumber}  created=${s.createdAt?.toISOString().slice(0,19)}  viewed=${s.firstViewedByAdminAt?.toISOString().slice(0,19)}  ${match?'✓ match':'— diverges'}`)
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
