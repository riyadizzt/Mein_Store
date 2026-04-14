/**
 * E2E test for the blocked-account login message.
 *
 * Creates a throwaway user, blocks them, tries to log in, verifies the
 * backend returns the new AccountBlocked structured error. Also tests:
 *   - Wrong password: still returns blocked message (check is BEFORE password)
 *   - Unblocked user: login still works (no regression)
 *   - Frontend receives localized message based on locale
 *
 * Cleans up the test user completely.
 */

import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'

const prisma = new PrismaClient()
const API = 'http://localhost:3001/api/v1'

type R = { name: string; status: 'PASS' | 'FAIL'; note?: string }
const results: R[] = []
const pass = (n: string, note?: string) => { results.push({ name: n, status: 'PASS', note }); console.log(`  ✅ ${n}${note ? ` — ${note}` : ''}`) }
const fail = (n: string, note: string) => { results.push({ name: n, status: 'FAIL', note }); console.log(`  ❌ ${n} — ${note}`) }

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  BLOCKED LOGIN — E2E test')
  console.log('═══════════════════════════════════════════════════════════\n')

  const unique = Date.now()
  const testEmail = `blocked-test-${unique}@malak-test.local`
  const realPassword = 'RealPass$2026'
  const wrongPassword = 'WrongPass$9999'

  let userId: string | null = null

  try {
    // ── 1. Create unblocked user ──
    console.log('── 1. Setup — fresh unblocked user ──')
    const user = await prisma.user.create({
      data: {
        email: testEmail,
        passwordHash: await bcrypt.hash(realPassword, 12),
        firstName: 'Blocked',
        lastName: 'Test',
        role: 'customer',
        isVerified: true,
        isActive: true,
        isBlocked: false,
      },
    })
    userId = user.id
    pass('user created', testEmail)

    // ── 2. Baseline — unblocked login works ──
    console.log('\n── 2. Baseline — unblocked login works ──')
    const baselineRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: realPassword }),
    })
    if (baselineRes.ok) {
      pass('baseline login', `HTTP ${baselineRes.status}`)
    } else {
      fail('baseline login', `expected 200, got ${baselineRes.status}: ${await baselineRes.text()}`)
      return
    }

    // ── 3. Block the user ──
    console.log('\n── 3. Admin blocks user ──')
    await prisma.user.update({
      where: { id: user.id },
      data: { isBlocked: true, blockedAt: new Date(), blockReason: 'Test block' },
    })
    pass('block applied', 'isBlocked=true')

    // ── 4. Blocked user + correct password ──
    console.log('\n── 4. Blocked user tries login with CORRECT password ──')
    const blockedRightRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: realPassword }),
    })
    const blockedRightBody: any = await blockedRightRes.json().catch(() => ({}))

    if (blockedRightRes.status !== 403) {
      fail('blocked+correct status', `expected 403, got ${blockedRightRes.status}`)
    } else {
      pass('blocked+correct status', `HTTP 403`)
    }

    if (blockedRightBody?.error === 'AccountBlocked') {
      pass('error code', `error="AccountBlocked"`)
    } else {
      fail('error code', `expected AccountBlocked, got ${blockedRightBody?.error}`)
    }

    if (typeof blockedRightBody?.message === 'object' &&
        blockedRightBody.message.de &&
        blockedRightBody.message.en &&
        blockedRightBody.message.ar) {
      pass('localized messages', 'de, en, ar all present')
      console.log(`        de: ${blockedRightBody.message.de}`)
      console.log(`        en: ${blockedRightBody.message.en}`)
      console.log(`        ar: ${blockedRightBody.message.ar}`)
    } else {
      fail('localized messages', `got ${JSON.stringify(blockedRightBody?.message).slice(0, 150)}`)
    }

    // ── 5. Blocked user + WRONG password ──
    console.log('\n── 5. Blocked user tries login with WRONG password ──')
    console.log('        Expected: SAME blocked message (check runs BEFORE password)')
    const blockedWrongRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: wrongPassword }),
    })
    const blockedWrongBody: any = await blockedWrongRes.json().catch(() => ({}))

    if (blockedWrongRes.status === 403 && blockedWrongBody?.error === 'AccountBlocked') {
      pass('blocked+wrong still shows block', 'user does not need to guess password')
    } else {
      fail('blocked+wrong', `expected 403 AccountBlocked, got ${blockedWrongRes.status} ${blockedWrongBody?.error}`)
    }

    // ── 6. No loginAttempts counter bump for blocked ──
    console.log('\n── 6. loginAttempts not bumped when blocked ──')
    const afterWrong = await prisma.user.findUnique({ where: { id: user.id } })
    if (afterWrong?.loginAttempts === 0) {
      pass('no attempts counter', 'loginAttempts still 0 (block prevented password check)')
    } else {
      fail('no attempts counter', `loginAttempts=${afterWrong?.loginAttempts}`)
    }

    // ── 6b. Passwordless (OAuth) user + blocked ──
    console.log('\n── 6b. OAuth user (passwordHash=null) + blocked ──')
    console.log('        Must ALSO see the blocked message, not "wrong password"')
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: null }, // simulate Google/Facebook signup
    })
    const oauthBlockedRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'anything' }),
    })
    const oauthBlockedBody: any = await oauthBlockedRes.json().catch(() => ({}))
    if (oauthBlockedRes.status === 403 && oauthBlockedBody?.error === 'AccountBlocked') {
      pass('OAuth blocked shows block message', 'no password leak')
    } else {
      fail('OAuth blocked', `expected 403 AccountBlocked, got ${oauthBlockedRes.status} ${oauthBlockedBody?.error}`)
    }

    // Restore password for the rest of the test
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(realPassword, 12) },
    })

    // ── 7. Unblock and verify login works again ──
    console.log('\n── 7. Unblock → login works again ──')
    await prisma.user.update({
      where: { id: user.id },
      data: { isBlocked: false, blockedAt: null, blockReason: null },
    })
    const unblockedRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: realPassword }),
    })
    if (unblockedRes.ok) {
      pass('unblock restores login', `HTTP ${unblockedRes.status}`)
    } else {
      fail('unblock', `expected 200, got ${unblockedRes.status}`)
    }

  } finally {
    console.log('\n── Cleanup ──')
    if (userId) {
      await prisma.refreshToken.deleteMany({ where: { userId } }).catch(() => {})
      await prisma.user.delete({ where: { id: userId } }).catch(() => {})
      console.log('  🧹 Test user deleted')
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════')
  const p = results.filter((r) => r.status === 'PASS').length
  const f = results.filter((r) => r.status === 'FAIL').length
  console.log(`  RESULT: ${p} passed, ${f} failed`)
  console.log('═══════════════════════════════════════════════════════════')
  process.exit(f > 0 ? 1 : 0)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
