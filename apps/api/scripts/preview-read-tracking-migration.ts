import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const orders = await prisma.order.count({ where: {} })
  const deleted = await prisma.order.count({ where: { deletedAt: { not: null } } })
  const byStatusRaw = await prisma.order.groupBy({ by: ['status'], _count: true, where: { deletedAt: null } })
  const openCount = byStatusRaw.filter(s => ['pending','pending_payment','confirmed','processing'].includes(s.status as any)).reduce((acc,s)=>acc+s._count, 0)

  console.log('\n═══ Migration Preview ═══\n')
  console.log(`  Total orders:     ${orders}`)
  console.log(`  Soft-deleted:     ${deleted}`)
  console.log(`  Open (4 statuses): ${openCount}`)
  console.log()
  console.log(`  Backfill-Plan:    Alle ${orders} Orders kriegen first_viewed_by_admin_at = created_at`)
  console.log(`                    Nach Migration: Badge = 0 (kein Noise)`)
  console.log(`                    Nächste neue Bestellung → Badge = 1`)
  console.log()
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
