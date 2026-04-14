import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  console.log('── Stub-Guest Orders: Status Breakdown ──\n')

  const orders = await prisma.order.findMany({
    where: {
      deletedAt: null,
      user: { is: { passwordHash: null } },
    },
    include: { user: { select: { email: true, createdAt: true } } },
    orderBy: { createdAt: 'desc' },
  })

  const byStatus: Record<string, any[]> = {}
  for (const o of orders) {
    let notes: any = {}
    try { notes = JSON.parse(o.notes ?? '{}') } catch {}
    const bucket = byStatus[o.status] ?? (byStatus[o.status] = [])
    bucket.push({
      orderNumber: o.orderNumber,
      email: o.user?.email,
      hasToken: !!notes.inviteToken,
      createdAt: o.createdAt,
    })
  }

  console.log(`Total stub-guest orders: ${orders.length}\n`)

  const order = ['pending', 'pending_payment', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded', 'returned']
  for (const status of order) {
    const bucket = byStatus[status]
    if (!bucket || bucket.length === 0) continue
    const withTok = bucket.filter((b) => b.hasToken).length
    const withoutTok = bucket.length - withTok
    const needsAttention = ['confirmed', 'processing', 'shipped', 'delivered'].includes(status)
    const marker = needsAttention && withoutTok > 0 ? '⚠️ ' : '   '
    console.log(`${marker}${status.padEnd(18)} total=${bucket.length.toString().padStart(3)}  withToken=${withTok.toString().padStart(3)}  missing=${withoutTok.toString().padStart(3)}`)
  }

  // The ones that actually matter: still-active orders (not cancelled) that lack a token
  console.log('\n── Stub-guests in ACTIVE status without inviteToken (= real backfill candidates) ──')
  const active = orders.filter((o) => {
    if (['cancelled', 'refunded', 'returned'].includes(o.status)) return false
    try { return !JSON.parse(o.notes ?? '{}').inviteToken } catch { return true }
  })
  console.log(`Found: ${active.length}`)

  // Dedupe by email — same customer may have multiple orders
  const uniqueEmails = new Set(active.map((o) => o.user?.email).filter(Boolean))
  console.log(`Unique customers affected: ${uniqueEmails.size}`)

  if (active.length > 0) {
    console.log('\n  Details:')
    active.slice(0, 20).forEach((o: any) => {
      console.log(`    ${o.orderNumber}  ${o.status.padEnd(12)}  ${o.user?.email}`)
    })
  }

  // Also: how many stub users are there in total?
  const stubUsers = await prisma.user.count({ where: { passwordHash: null, role: 'customer' } })
  const realUsers = await prisma.user.count({ where: { passwordHash: { not: null }, role: 'customer' } })
  console.log(`\n── User Registry ──`)
  console.log(`  Real customer accounts:  ${realUsers}`)
  console.log(`  Stub customer accounts:  ${stubUsers}  ← customers without password`)
}

main().finally(() => prisma.$disconnect())
