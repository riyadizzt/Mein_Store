import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const g = await prisma.order.groupBy({
    by: ['status'],
    where: { createdAt: { gte: new Date('2026-04-01'), lte: new Date('2026-04-16T23:59:59') }, channel: { in: ['website', 'mobile'] as any }, deletedAt: null },
    _count: { _all: true },
  })
  console.log('April orders by status:')
  for (const x of g) console.log(`  ${x.status.padEnd(15)} ${x._count._all}`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
