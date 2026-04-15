import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const counts = await prisma.stockReservation.groupBy({
    by: ['status'],
    _count: { _all: true },
    _sum: { quantity: true },
  })
  console.log('\n── Reservation status breakdown ──')
  for (const c of counts) {
    console.log(`  ${c.status.padEnd(12)} rows: ${c._count._all}, total qty: ${c._sum.quantity}`)
  }

  const sample = await prisma.stockReservation.findMany({
    where: { status: 'RESERVED' },
    take: 5,
    orderBy: { createdAt: 'desc' },
    include: {
      variant: {
        select: {
          sku: true, color: true, size: true,
          product: { select: { translations: { select: { language: true, name: true } } } },
        },
      },
      warehouse: { select: { name: true } },
    },
  })
  console.log('\n── Sample RESERVED (latest 5) ──')
  for (const r of sample) {
    const name = r.variant.product.translations.find((t: { language: string; name: string }) => t.language === 'de')?.name ?? '?'
    console.log(`  ${r.variant.sku} · ${r.variant.color}/${r.variant.size} · ${r.quantity}x · ${r.warehouse.name} · order=${r.orderId?.slice(0,8) ?? 'null'}`)
    console.log(`    ${name}`)
  }

  // Resolve order numbers
  const orderIds = [...new Set(sample.map(r => r.orderId).filter((x): x is string => !!x))]
  if (orderIds.length > 0) {
    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, orderNumber: true, status: true },
    })
    console.log('\n── Linked orders ──')
    for (const o of orders) {
      console.log(`  ${o.id.slice(0, 8)} → ${o.orderNumber} (${o.status})`)
    }
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
