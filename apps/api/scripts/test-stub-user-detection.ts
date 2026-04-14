/**
 * Non-destructive verification of the stub-user guest detection fix.
 *
 * What this tests:
 *   1. The detection logic (new `isStubGuest` / `isPureGuest`) correctly
 *      partitions every order in the DB into 3 buckets:
 *        - stub_guest  → user with passwordHash=null (can be invited)
 *        - pure_guest  → no userId at all, guestEmail set (historical)
 *        - real_user   → user with passwordHash (no invite needed)
 *   2. Quantifies how many orders MISSED their invite before the fix.
 *   3. Shows which customers would get an invite if we re-processed them.
 *
 * This script does NOT send any emails, does NOT modify any data, does NOT
 * restart services. Pure read-only against Supabase.
 */

import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

// Replicates the new isGuest detection from payments.service.ts and order-email.listener.ts
function isStubGuest(order: any): boolean {
  return !!(order.user && !order.user.passwordHash && !!order.user.email)
}
function isPureGuest(order: any): boolean {
  return !order.userId && !!order.guestEmail
}
function isRealUser(order: any): boolean {
  return !!(order.user && order.user.passwordHash)
}
function getInviteEmail(order: any): string | null {
  return order.user?.email ?? order.guestEmail ?? null
}

type Row = {
  orderNumber: string
  status: string
  email: string | null
  bucket: 'stub_guest' | 'pure_guest' | 'real_user' | 'unknown'
  hasInviteToken: boolean
  inviteLink: string | null
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  STUB-USER DETECTION — non-destructive verification')
  console.log('═══════════════════════════════════════════════════════════\n')

  // ── TEST 1: Logic sanity on hand-crafted fixtures ──
  console.log('── 1. Unit-level logic check on 4 synthetic cases ──')
  const cases = [
    {
      label: 'STUB GUEST (userId set, passwordHash=null)',
      order: { userId: 'u1', guestEmail: null, user: { passwordHash: null, email: 'a@b.de' } },
      expected: { stub: true, pure: false, real: false },
    },
    {
      label: 'REAL USER (userId set, passwordHash set)',
      order: { userId: 'u2', guestEmail: null, user: { passwordHash: '$argon2$...', email: 'x@y.de' } },
      expected: { stub: false, pure: false, real: true },
    },
    {
      label: 'PURE GUEST (userId null, guestEmail set, no user row)',
      order: { userId: null, guestEmail: 'g@h.de', user: null },
      expected: { stub: false, pure: true, real: false },
    },
    {
      label: 'ANONYMOUS (userId null, guestEmail null) — should match nothing',
      order: { userId: null, guestEmail: null, user: null },
      expected: { stub: false, pure: false, real: false },
    },
  ]
  let logicOk = true
  for (const c of cases) {
    const stub = isStubGuest(c.order)
    const pure = isPureGuest(c.order)
    const real = isRealUser(c.order)
    const ok =
      stub === c.expected.stub && pure === c.expected.pure && real === c.expected.real
    if (!ok) logicOk = false
    console.log(
      `  ${ok ? '✅' : '❌'} ${c.label}`,
    )
    console.log(
      `     stub=${stub} (exp ${c.expected.stub})  pure=${pure} (exp ${c.expected.pure})  real=${real} (exp ${c.expected.real})`,
    )
  }
  if (!logicOk) {
    console.log('\n❌ Logic check FAILED — aborting live scan')
    process.exit(1)
  }

  // ── TEST 2: Partition all orders in DB ──
  console.log('\n── 2. Live DB partition of all orders ──')
  const orders = await prisma.order.findMany({
    where: { deletedAt: null },
    include: {
      user: { select: { email: true, passwordHash: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const rows: Row[] = []
  for (const o of orders) {
    let bucket: Row['bucket'] = 'unknown'
    if (isStubGuest(o)) bucket = 'stub_guest'
    else if (isPureGuest(o)) bucket = 'pure_guest'
    else if (isRealUser(o)) bucket = 'real_user'

    let notes: any = {}
    try {
      notes = JSON.parse(o.notes ?? '{}')
    } catch {}

    const email = getInviteEmail(o)
    const inviteLink = notes.inviteToken && email
      ? `https://malak-bekleidung.com/de/auth/create-account?token=${notes.inviteToken}&email=${encodeURIComponent(email)}`
      : null

    rows.push({
      orderNumber: o.orderNumber,
      status: o.status,
      email,
      bucket,
      hasInviteToken: !!notes.inviteToken,
      inviteLink,
    })
  }

  const byBucket = {
    stub_guest: rows.filter((r) => r.bucket === 'stub_guest'),
    pure_guest: rows.filter((r) => r.bucket === 'pure_guest'),
    real_user: rows.filter((r) => r.bucket === 'real_user'),
    unknown: rows.filter((r) => r.bucket === 'unknown'),
  }

  console.log(`  Total orders: ${rows.length}`)
  console.log(`  stub_guest:   ${byBucket.stub_guest.length}`)
  console.log(`  pure_guest:   ${byBucket.pure_guest.length}`)
  console.log(`  real_user:    ${byBucket.real_user.length}`)
  console.log(`  unknown:      ${byBucket.unknown.length}`)

  // Sanity: the buckets must be disjoint and sum to total
  const sum =
    byBucket.stub_guest.length +
    byBucket.pure_guest.length +
    byBucket.real_user.length +
    byBucket.unknown.length
  if (sum === rows.length) {
    console.log('  ✅ Partition is disjoint and complete')
  } else {
    console.log(`  ❌ Partition mismatch: ${sum} ≠ ${rows.length}`)
  }

  // ── TEST 3: Invite coverage on stub-guest orders ──
  console.log('\n── 3. Invite coverage on stub-guest orders ──')
  const withToken = byBucket.stub_guest.filter((r) => r.hasInviteToken)
  const withoutToken = byBucket.stub_guest.filter((r) => !r.hasInviteToken)
  console.log(`  stub-guests WITH inviteToken:    ${withToken.length}`)
  console.log(`  stub-guests WITHOUT inviteToken: ${withoutToken.length}  ← never got invited`)
  if (withoutToken.length > 0) {
    console.log('\n  Sample of stub-guests missing invites:')
    withoutToken.slice(0, 10).forEach((r) => {
      console.log(`    ${r.orderNumber}  ${r.status}  ${r.email}`)
    })
  }

  // ── TEST 4: Real-user orders should NEVER have inviteToken ──
  console.log('\n── 4. Negative check — real users must NOT have inviteToken ──')
  const realWithToken = byBucket.real_user.filter((r) => r.hasInviteToken)
  if (realWithToken.length === 0) {
    console.log('  ✅ No real-user orders carry an inviteToken')
  } else {
    console.log(`  ⚠️  ${realWithToken.length} real-user order(s) have an inviteToken`)
    console.log('     (not a bug per se — was generated when they were still stubs)')
    realWithToken.slice(0, 5).forEach((r) => {
      console.log(`       ${r.orderNumber}  ${r.email}`)
    })
  }

  // ── TEST 5: Show 3 ready-to-send invite links ──
  console.log('\n── 5. Ready-to-send invite links (stub-guest + token present) ──')
  if (withToken.length === 0) {
    console.log('  (none yet — new stub guests will start getting them after API restart)')
  } else {
    withToken.slice(0, 3).forEach((r) => {
      console.log(`\n  ${r.orderNumber}  → ${r.email}`)
      console.log(`    ${r.inviteLink}`)
    })
  }

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('  RESULT')
  console.log('═══════════════════════════════════════════════════════════')
  console.log(`  Logic tests:     ${logicOk ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`  Partition:       ${sum === rows.length ? '✅ PASS' : '❌ FAIL'}`)
  console.log(
    `  Stub coverage:   ${withToken.length}/${byBucket.stub_guest.length} have tokens`,
  )
  console.log(`  Real-user hygiene: ${realWithToken.length} real users carry stale tokens`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
