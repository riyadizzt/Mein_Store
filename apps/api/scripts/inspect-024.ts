import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const order: any = await prisma.order.findFirst({
    where: { orderNumber: 'ORD-20260413-000024' },
    include: { payment: true, user: { select: { id: true, email: true } } },
  })
  if (!order) {
    console.log('Order 000024 not found')
    return
  }
  console.log('─── ORD-20260413-000024 ───')
  console.log('id         ', order.id)
  console.log('status     ', order.status)
  console.log('total      ', order.totalAmount)
  console.log('userId     ', order.userId ?? '(null → GUEST)')
  console.log('guestEmail ', order.guestEmail ?? '—')
  console.log('createdAt  ', order.createdAt.toISOString())
  console.log('updatedAt  ', order.updatedAt.toISOString())

  console.log('\n── notes ──')
  let parsed: any = null
  try {
    parsed = JSON.parse(order.notes ?? '{}')
  } catch (e) {
    console.log('  ❌ notes is malformed JSON:', order.notes)
  }
  if (parsed) {
    console.log('  reservationIds:      ', parsed.reservationIds ?? '—')
    console.log('  inviteToken:         ', parsed.inviteToken ?? '❌ MISSING')
    console.log('  confirmationToken:   ', parsed.confirmationToken ?? '❌ MISSING')
  }

  if (order.payment) {
    console.log('\n── Payment ──')
    console.log('  provider   ', order.payment.provider)
    console.log('  status     ', order.payment.status)
    console.log('  paidAt     ', order.payment.paidAt?.toISOString() ?? '—')
  }

  // Diagnosis
  console.log('\n── Diagnosis ──')
  const isGuest = !order.userId && !!order.guestEmail
  if (!isGuest) {
    console.log('  ⚠️  NOT a guest order — no invite expected')
  } else if (parsed?.inviteToken) {
    console.log('  ✅ Guest + token present — email listener should have fired')
    console.log(`     Link: {APP_URL}/de/auth/create-account?token=${parsed.inviteToken}&email=${order.guestEmail}`)
  } else {
    console.log('  ❌ Guest but NO inviteToken → confirms: fix was not live when this order was processed')
    console.log('  Fix: restart the API server and manually backfill this order')
  }

  // Also count how many old guest orders are missing the token
  const allGuestConfirmed = await prisma.order.findMany({
    where: {
      userId: null,
      guestEmail: { not: null },
      status: { in: ['confirmed', 'processing', 'shipped', 'delivered'] },
      deletedAt: null,
    },
    select: { orderNumber: true, notes: true, guestEmail: true, createdAt: true },
  })
  const missing = allGuestConfirmed.filter((o) => {
    try { return !JSON.parse(o.notes ?? '{}').inviteToken } catch { return true }
  })
  console.log(`\n── Other guest orders missing inviteToken: ${missing.length} / ${allGuestConfirmed.length} ──`)
  for (const m of missing.slice(0, 10)) {
    console.log(`  ${m.orderNumber}  ${m.guestEmail}  ${m.createdAt.toISOString()}`)
  }
}

main().finally(() => prisma.$disconnect())
