import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const order = await prisma.order.findFirst({
    where: { orderNumber: 'ORD-20260415-000014' },
    include: { payment: true },
  })

  if (!order) {
    console.log('Order not found')
    await prisma.$disconnect()
    return
  }

  console.log('\n── Order ORD-20260415-000014 ──\n')
  console.log('  id:          ', order.id)
  console.log('  orderNumber: ', order.orderNumber)
  console.log('  status:      ', order.status, '  ← must be pending or pending_payment')
  console.log('  createdAt:   ', order.createdAt.toISOString())
  console.log('  deletedAt:   ', order.deletedAt?.toISOString() ?? 'null')
  console.log('')
  console.log('  Payment:')
  if (!order.payment) {
    console.log('    ❌ NO PAYMENT ROW — this is the problem! Vorkasse orders should have a payment row.')
  } else {
    console.log('    id:                ', order.payment.id)
    console.log('    provider:          ', order.payment.provider, '  ← must be "VORKASSE" (exact string)')
    console.log('    status:            ', order.payment.status, '  ← must be "pending"')
    console.log('    createdAt:         ', order.payment.createdAt.toISOString())
    console.log('    metadata:          ', JSON.stringify(order.payment.metadata))
  }

  // Now check settings
  console.log('\n── ShopSettings ──\n')
  const settings = await prisma.shopSetting.findMany({
    where: { key: { in: ['vorkasse_enabled', 'vorkasse_cancel_days', 'vorkasse_reminder_days', 'vorkasse_deadline_days'] } },
  })
  for (const s of settings) {
    console.log(`  ${s.key.padEnd(28)} = "${s.value}"`)
  }
  if (settings.length === 0) console.log('  (none set — using defaults)')

  // Now simulate the frontend logic
  if (order.payment) {
    console.log('\n── Frontend logic simulation ──\n')
    const checks = [
      ['order.payment?.provider === "VORKASSE"', order.payment.provider === 'VORKASSE'],
      ['order.payment?.status === "pending"', order.payment.status === 'pending'],
      ['order.status in [pending, pending_payment]', ['pending', 'pending_payment'].includes(order.status)],
    ]
    for (const [desc, ok] of checks) {
      console.log(`  ${ok ? '✅' : '❌'}  ${desc}`)
    }
    const allOk = checks.every((c) => c[1])
    if (allOk) {
      const cancelDays = Number(settings.find((s) => s.key === 'vorkasse_cancel_days')?.value ?? 10)
      const deadline = new Date(order.createdAt.getTime() + cancelDays * 24 * 60 * 60 * 1000)
      const msLeft = deadline.getTime() - Date.now()
      const isPast = msLeft < 0
      const hoursLeft = Math.floor(Math.abs(msLeft) / (60 * 60 * 1000))
      console.log('')
      console.log(`  cancelDays used:  ${cancelDays}`)
      console.log(`  deadline:         ${deadline.toISOString()}`)
      console.log(`  now:              ${new Date().toISOString()}`)
      console.log(`  msLeft:           ${msLeft}`)
      console.log(`  isPast:           ${isPast}`)
      console.log(`  hours left:       ${hoursLeft}`)
      console.log(`  → countdown should render: YES`)
    } else {
      console.log('\n  → countdown will NOT render (at least one guard failed)')
    }
  }

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
