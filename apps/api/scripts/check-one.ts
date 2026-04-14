import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const o: any = await prisma.order.findFirst({
    where: { orderNumber: 'ORD-20260328-000015' },
    include: {
      user: { select: { firstName: true, lastName: true, email: true } },
      shippingAddress: true,
    },
  })
  if (!o) { console.log('not found'); return }
  console.log('orderNumber           :', o.orderNumber)
  console.log('shippingAddressId     :', o.shippingAddressId)
  console.log('shippingAddress       :', o.shippingAddress ? 'EXISTS' : 'null')
  console.log('shippingAddressSnapshot:', JSON.stringify(o.shippingAddressSnapshot))
  console.log('user.firstName        :', JSON.stringify(o.user?.firstName))
  console.log('user.lastName         :', JSON.stringify(o.user?.lastName))
}
main().finally(() => prisma.$disconnect())
