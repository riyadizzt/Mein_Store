import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const orders = await prisma.order.findMany({
    select: { id: true, orderNumber: true, notes: true, createdAt: true, status: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  console.log(`Scanning ${orders.length} most-recent orders for notes.reservationIds...\n`)
  let withResIds = 0
  let without = 0
  for (const o of orders) {
    let notes: any = {}
    try { notes = JSON.parse(o.notes ?? '{}') } catch {}
    const has = Array.isArray(notes.reservationIds) && notes.reservationIds.length > 0
    if (has) withResIds++
    else without++
  }
  console.log(`WITH reservationIds:    ${withResIds}`)
  console.log(`WITHOUT reservationIds: ${without}`)
  console.log('')
  // Show last 10
  console.log('Sample (latest 10):')
  for (const o of orders.slice(0, 10)) {
    let notes: any = {}
    try { notes = JSON.parse(o.notes ?? '{}') } catch {}
    const keys = Object.keys(notes).join(', ')
    const resCount = Array.isArray(notes.reservationIds) ? notes.reservationIds.length : 'none'
    console.log(`  ${o.orderNumber.padEnd(22)} ${o.createdAt.toISOString().slice(0, 19)}  status=${o.status.padEnd(15)}  resIds=${String(resCount).padStart(4)}  keys=[${keys}]`)
  }
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
