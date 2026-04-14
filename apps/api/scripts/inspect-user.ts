import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const user: any = await prisma.user.findUnique({
    where: { id: '3a77b3ed-baba-479a-8b27-7e4ddd049397' },
  })
  if (!user) {
    console.log('User not found')
    return
  }
  console.log('─── User 3a77b3ed... ───')
  console.log('email             ', user.email)
  console.log('firstName         ', user.firstName)
  console.log('lastName          ', user.lastName)
  console.log('createdAt         ', user.createdAt.toISOString())
  console.log('emailVerifiedAt   ', user.emailVerifiedAt?.toISOString() ?? '❌ NOT VERIFIED')
  console.log('password          ', user.password ? `✅ set (${user.password.length} chars)` : '❌ NOT SET')
  console.log('provider          ', user.provider ?? '—')
  console.log('role              ', user.role)

  // Find the order again
  const order: any = await prisma.order.findFirst({
    where: { orderNumber: 'ORD-20260413-000024' },
    select: { createdAt: true, updatedAt: true, userId: true },
  })
  console.log('\n─── Order ORD-20260413-000024 ───')
  console.log('created           ', order.createdAt.toISOString())
  console.log('updated           ', order.updatedAt.toISOString())
  console.log('userId            ', order.userId)
  const timeOrderAfterUser = order.createdAt.getTime() - user.createdAt.getTime()
  console.log(`\n Order created ${Math.round(timeOrderAfterUser / 1000)}s after user`)
  if (timeOrderAfterUser < 0) {
    console.log('  → Order was placed BEFORE the user was registered — guest flow')
  } else if (timeOrderAfterUser < 5000) {
    console.log('  → Order and user were created within 5s — user probably registered AT checkout')
  } else {
    console.log('  → User existed before the order — normal logged-in checkout')
  }

  // Count all orders for this user
  const allOrders = await prisma.order.findMany({
    where: { userId: user.id },
    select: { orderNumber: true, createdAt: true, status: true },
    orderBy: { createdAt: 'desc' },
  })
  console.log(`\n User has ${allOrders.length} linked order(s):`)
  for (const o of allOrders) {
    console.log(`  ${o.orderNumber}  ${o.createdAt.toISOString()}  ${o.status}`)
  }
}

main().finally(() => prisma.$disconnect())
