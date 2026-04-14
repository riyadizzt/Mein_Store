import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  console.log('── Orders without any shipping address info ──\n')

  // ALL orders (not just stubs) that have neither shippingAddress nor snapshot
  const broken: any[] = await prisma.order.findMany({
    where: {
      shippingAddressId: null,
      shippingAddressSnapshot: { equals: null as any },
      deletedAt: null,
    },
    include: {
      user: { select: { email: true, passwordHash: true } },
      payment: { select: { provider: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  console.log(`Total orders without shipping data: ${broken.length}\n`)

  // Partition by date
  const now = Date.now()
  const buckets = {
    today: [] as any[],
    thisWeek: [] as any[],
    older: [] as any[],
  }
  for (const o of broken) {
    const ageMs = now - o.createdAt.getTime()
    if (ageMs < 24 * 3600 * 1000) buckets.today.push(o)
    else if (ageMs < 7 * 24 * 3600 * 1000) buckets.thisWeek.push(o)
    else buckets.older.push(o)
  }

  console.log(`  Today:     ${buckets.today.length}`)
  console.log(`  This week: ${buckets.thisWeek.length}`)
  console.log(`  Older:     ${buckets.older.length}`)

  // Show today's orders (the critical ones — means CURRENT code allows it)
  if (buckets.today.length > 0) {
    console.log('\n🚨 TODAY — current code allowed these:')
    for (const o of buckets.today.slice(0, 10)) {
      console.log(`   ${o.orderNumber}  ${o.status}  €${o.totalAmount}  ${o.user?.email}`)
    }
  }

  // Show this week
  if (buckets.thisWeek.length > 0) {
    console.log('\n⚠️  This week:')
    for (const o of buckets.thisWeek.slice(0, 10)) {
      console.log(`   ${o.orderNumber}  ${o.status}  ${o.user?.email}`)
    }
  }

  // How many had an invoice generated?
  const orderIds = broken.map((o) => o.id)
  if (orderIds.length > 0) {
    const invoices = await prisma.invoice.count({ where: { orderId: { in: orderIds } } })
    console.log(`\n── Invoices generated for these ${broken.length} orders: ${invoices} ──`)
    if (invoices > 0) {
      console.log('  🚨 Real bug: some of these orders have invoices with garbage names')
      const withInvoices = await prisma.invoice.findMany({
        where: { orderId: { in: orderIds } },
        include: { order: { select: { orderNumber: true } } },
      })
      for (const inv of withInvoices.slice(0, 10)) {
        console.log(`     ${inv.invoiceNumber}  for  ${inv.order?.orderNumber}`)
      }
    } else {
      console.log('  ✅ None of these orders generated an invoice (never reached captured/confirmed)')
    }
  }

  // Partition by status
  const byStatus: Record<string, number> = {}
  for (const o of broken) {
    byStatus[o.status] = (byStatus[o.status] ?? 0) + 1
  }
  console.log('\n── By status ──')
  for (const [status, count] of Object.entries(byStatus)) {
    console.log(`  ${status}: ${count}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
