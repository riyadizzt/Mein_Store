import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const ids = ['4d849f1d', 'a4c20e42']
  for (const shortId of ids) {
    const o = await prisma.order.findFirst({
      where: { id: { startsWith: shortId } },
      select: {
        id: true, orderNumber: true, status: true, createdAt: true, totalAmount: true,
        payment: { select: { status: true, provider: true } },
        user: { select: { email: true } },
      },
    })
    if (!o) { console.log(`${shortId} not found`); continue }
    const ageMin = Math.round((Date.now() - o.createdAt.getTime()) / 60000)
    console.log(`${o.orderNumber}  status=${o.status.padEnd(15)}  payment=${(o.payment?.status ?? 'no-payment').padEnd(18)}  provider=${o.payment?.provider ?? '-'}  age=${ageMin}min  email=${o.user?.email ?? '-'}`)
  }
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
