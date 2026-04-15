/**
 * Read-only verification of the 15.04.2026 OAuth-guest-detection fix.
 *
 * Scans all users that currently have `passwordHash=null` and partitions
 * them by the 3-signal logic. Confirms that the reported user
 * `cro.defi.mail@gmail.com` is correctly classified under the new rule.
 *
 * Then simulates what the NEW fix would decide vs. what the OLD buggy
 * code would have decided, and shows the delta.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  console.log('\n── 1. Direct inspection of cro.defi.mail@gmail.com ─────────\n')
  const subject = await prisma.user.findFirst({
    where: { email: 'cro.defi.mail@gmail.com' },
    select: {
      id: true, email: true, passwordHash: true, isVerified: true, firstName: true,
      oauthAccounts: { select: { provider: true, providerAccountId: true } },
    },
  })
  if (!subject) {
    console.log('   user not found')
  } else {
    console.log(`   id            ${subject.id}`)
    console.log(`   email         ${subject.email}`)
    console.log(`   firstName     ${subject.firstName ?? '(none)'}`)
    console.log(`   passwordHash  ${subject.passwordHash ? '[set]' : 'null'}`)
    console.log(`   isVerified    ${subject.isVerified}`)
    console.log(`   oauthAccounts [${subject.oauthAccounts.map((o) => o.provider).join(', ') || 'none'}]`)
    const oldBuggyGuest = !subject.passwordHash && !!subject.email
    const newCorrectGuest =
      !subject.passwordHash &&
      (subject.oauthAccounts.length === 0) &&
      !subject.isVerified &&
      !!subject.email
    console.log('')
    console.log(`   OLD code said: isStubGuest = ${oldBuggyGuest}  ${oldBuggyGuest ? '→ would send invite email' : ''}`)
    console.log(`   NEW code says: isStubGuest = ${newCorrectGuest}  ${newCorrectGuest ? '→ would send invite email' : '→ no invite (correct!)'}`)
  }

  console.log('\n── 2. Full partition of users with passwordHash=null ───────\n')
  const allStubCandidates = await prisma.user.findMany({
    where: { passwordHash: null },
    select: {
      id: true, email: true, isVerified: true,
      oauthAccounts: { select: { id: true } },
      _count: { select: { orders: true } },
    },
  })

  let realStubGuests = 0
  let oauthPostFix = 0
  let legacyOauth = 0

  for (const u of allStubCandidates) {
    const hasOauth = u.oauthAccounts.length > 0
    if (hasOauth) oauthPostFix++
    else if (u.isVerified) legacyOauth++
    else realStubGuests++
  }

  const total = allStubCandidates.length
  console.log(`   Total users with passwordHash=null:  ${total}`)
  console.log(`     OAuth (oauthAccounts linked):      ${oauthPostFix}  ← new code: NOT guest`)
  console.log(`     Legacy OAuth (isVerified=true):    ${legacyOauth}  ← new code: NOT guest`)
  console.log(`     Real stub guests (all 3 signals):  ${realStubGuests}  ← new code: IS guest`)

  const oldCodeGuestCount = total  // old code classified ALL of them as guests
  const newCodeGuestCount = realStubGuests
  const delta = oldCodeGuestCount - newCodeGuestCount

  console.log('')
  console.log(`   OLD buggy code would classify: ${oldCodeGuestCount} as stub-guests`)
  console.log(`   NEW fixed code classifies:     ${newCodeGuestCount} as stub-guests`)
  console.log(`   Delta (bogus invites prevented going forward): ${delta}`)

  console.log('\n── 3. Historical orders at risk from the old code ──────────\n')
  // List any orders in the past 24h whose user would have been wrongly
  // classified, to show how much damage the bug caused before the fix.
  const recentRisky = await prisma.order.findMany({
    where: {
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      user: {
        passwordHash: null,
        OR: [
          { oauthAccounts: { some: {} } },
          { isVerified: true },
        ],
      },
    },
    select: {
      orderNumber: true, createdAt: true, notes: true,
      user: { select: { email: true, isVerified: true, oauthAccounts: { select: { provider: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  if (recentRisky.length === 0) {
    console.log('   No recent orders from OAuth users in the past 24h.')
  } else {
    console.log(`   Found ${recentRisky.length} recent order(s) from OAuth users:`)
    for (const o of recentRisky) {
      let notes: any = {}
      try { notes = JSON.parse(o.notes ?? '{}') } catch {}
      const hadInvite = !!notes.inviteToken
      const provider = o.user?.oauthAccounts[0]?.provider || (o.user?.isVerified ? 'legacy' : '?')
      console.log(`   ${o.orderNumber}  ${o.createdAt.toISOString().slice(0, 16)}  ${o.user?.email}  [${provider}]  inviteToken=${hadInvite ? '⚠ present (bug triggered)' : 'none (ok)'}`)
    }
  }

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
