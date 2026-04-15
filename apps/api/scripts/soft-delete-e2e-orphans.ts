import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const result = await prisma.order.updateMany({
    where: {
      orderNumber: { in: ['ORD-20260415-000010', 'ORD-20260415-000011'] },
      deletedAt: null,
    },
    data: { deletedAt: new Date() },
  })
  console.log(`Soft-deleted ${result.count} e2e test order(s)`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
