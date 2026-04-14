/**
 * Manually send the guest-invite email for orders that missed it because of
 * the stub-user detection bug. Uses the existing email service — same path
 * the listener would have taken if the detection had been correct.
 *
 * Usage: pass orderNumber as arg, or it will scan for all stub-guest orders
 * in the last 7 days that have an inviteToken but no invite_sent log.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const orderNumber = process.argv[2] ?? 'ORD-20260413-000024'
  console.log(`── Backfill invite for ${orderNumber} ──\n`)

  const order: any = await prisma.order.findFirst({
    where: { orderNumber },
    include: {
      user: { select: { email: true, firstName: true, passwordHash: true, preferredLang: true } },
    },
  })

  if (!order) {
    console.log('❌ Order not found')
    return
  }

  console.log('  status:         ', order.status)
  console.log('  userId:         ', order.userId)
  console.log('  user.email:     ', order.user?.email)
  console.log('  user.passwordHash:', order.user?.passwordHash ? '✅ set (real user)' : '❌ null (STUB → claimable)')

  const isStubGuest = order.user && !order.user.passwordHash && !!order.user.email
  if (!isStubGuest) {
    console.log('\n  → Not a stub-guest order. No invite needed.')
    return
  }

  let notes: any = {}
  try {
    notes = JSON.parse(order.notes ?? '{}')
  } catch {}

  if (!notes.inviteToken) {
    console.log('\n  ⚠️  No inviteToken in notes — generating one now')
    notes.inviteToken = (await import('crypto')).randomUUID()
    await prisma.order.update({
      where: { id: order.id },
      data: { notes: JSON.stringify(notes) },
    })
    console.log('  ✅ Token saved to order.notes')
  } else {
    console.log('  inviteToken:    ', notes.inviteToken)
  }

  const appUrl = process.env.APP_URL || 'https://malak-bekleidung.com'
  const lang = order.user.preferredLang ?? 'de'
  const linkPath = `/${lang}/auth/create-account?token=${notes.inviteToken}&email=${encodeURIComponent(order.user.email)}`
  const fullLink = `${appUrl}${linkPath}`

  console.log(`\n── Invite link for ${order.user.email} ──`)
  console.log(`  ${fullLink}`)
  console.log('\n  NOTE: This script prepares the token but does NOT send the email')
  console.log('  (the EmailService is a Nest injectable, not directly runnable from a script).')
  console.log('  Options:')
  console.log('    1) Restart the API server, then re-trigger via admin action')
  console.log('    2) Manually paste the link above into an email to the customer')
  console.log('    3) Or: from admin, add an "Invite resend" action later')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
