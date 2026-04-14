/**
 * End-to-end test for the password reset flow.
 *
 * Creates a throwaway test user, plants a reset token directly in the DB
 * (bypassing the email queue), calls the real API endpoints, and verifies
 * the whole chain works.
 *
 * Cleans up the test user completely — zero footprint on real data.
 */

import { PrismaClient } from '@prisma/client'
import * as crypto from 'crypto'
import * as bcrypt from 'bcrypt'

const prisma = new PrismaClient()
const API = 'http://localhost:3001/api/v1'

type Result = { name: string; status: 'PASS' | 'FAIL'; note?: string }
const results: Result[] = []
const pass = (n: string, note?: string) => { results.push({ name: n, status: 'PASS', note }); console.log(`  ✅ ${n}${note ? ` — ${note}` : ''}`) }
const fail = (n: string, note: string) => { results.push({ name: n, status: 'FAIL', note }); console.log(`  ❌ ${n} — ${note}`) }

const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex')

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  PASSWORD RESET — End-to-End Test')
  console.log('═══════════════════════════════════════════════════════════\n')

  const testEmail = `reset-test-${Date.now()}@malak-test.local`
  const originalPassword = 'Original$Password1'
  const newPassword = 'BrandNew#Password9'

  let userId: string | null = null

  try {
    // ── 1. Create test user with original password ──
    console.log('── 1. Setup — create temporary test user ──')
    const user = await prisma.user.create({
      data: {
        email: testEmail,
        passwordHash: await bcrypt.hash(originalPassword, 12),
        firstName: 'Reset',
        lastName: 'Test',
        role: 'customer',
        isVerified: true,
        isActive: true,
      },
    })
    userId = user.id
    pass('Test user created', testEmail)

    // ── 2. Verify original password works (login baseline) ──
    console.log('\n── 2. Baseline — login with original password ──')
    const loginRes1 = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: originalPassword }),
    })
    if (loginRes1.ok) {
      pass('Original password login works', `status ${loginRes1.status}`)
    } else {
      fail('Original password login', `status ${loginRes1.status}: ${await loginRes1.text()}`)
      return
    }

    // ── 3. Plant a reset token directly in DB (skip email queue) ──
    console.log('\n── 3. Plant reset token in DB (bypass email) ──')
    const rawToken = crypto.randomBytes(32).toString('hex')
    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 15 * 60_000), // 15 min
      },
    })
    pass('Reset token planted', `${rawToken.slice(0, 16)}...`)

    // ── 4. Frontend page loads with token query ──
    console.log('\n── 4. Frontend page reachable ──')
    const pageRes = await fetch(
      `http://localhost:3000/de/auth/reset-password?token=${rawToken}`,
    )
    if (pageRes.ok) {
      pass('Frontend page loads', `HTTP ${pageRes.status}`)
    } else {
      fail('Frontend page', `HTTP ${pageRes.status}`)
    }

    // ── 5. Invalid token is rejected ──
    console.log('\n── 5. Negative test — garbage token is rejected ──')
    const badRes = await fetch(`${API}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'garbage-token-xxx', password: newPassword }),
    })
    if (badRes.status >= 400) {
      pass('Garbage token rejected', `status ${badRes.status}`)
    } else {
      fail('Garbage token', 'should have been rejected')
    }

    // ── 6. Submit new password with the valid token ──
    console.log('\n── 6. POST new password with valid token ──')
    const resetRes = await fetch(`${API}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: rawToken, password: newPassword }),
    })
    if (resetRes.ok) {
      pass('Reset POST accepted', `status ${resetRes.status}`)
    } else {
      fail('Reset POST', `status ${resetRes.status}: ${await resetRes.text()}`)
      return
    }

    // ── 7. Verify PasswordReset.usedAt is now set ──
    console.log('\n── 7. DB — token marked as used ──')
    const resetRow = await prisma.passwordReset.findFirst({
      where: { userId: user.id, tokenHash: hashToken(rawToken) },
    })
    if (resetRow?.usedAt) {
      pass('Token marked usedAt', resetRow.usedAt.toISOString())
    } else {
      fail('Token usedAt', 'not marked as used — backend skipped the update')
    }

    // ── 8. Verify user.passwordHash actually changed ──
    console.log('\n── 8. DB — passwordHash actually updated ──')
    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } })
    const matchesOld = await bcrypt.compare(originalPassword, updatedUser!.passwordHash!)
    const matchesNew = await bcrypt.compare(newPassword, updatedUser!.passwordHash!)
    if (!matchesOld && matchesNew) {
      pass('Password hash updated', 'old rejected, new accepted')
    } else {
      fail('Password hash', `old=${matchesOld} new=${matchesNew}`)
    }

    // ── 9. Login with NEW password works ──
    console.log('\n── 9. Login with NEW password ──')
    const loginRes2 = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: newPassword }),
    })
    if (loginRes2.ok) {
      pass('New password login works')
    } else {
      fail('New password login', `status ${loginRes2.status}: ${await loginRes2.text()}`)
    }

    // ── 10. Login with OLD password must FAIL ──
    console.log('\n── 10. Login with OLD password must fail ──')
    const loginRes3 = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: originalPassword }),
    })
    if (loginRes3.status === 401 || loginRes3.status === 400) {
      pass('Old password correctly rejected', `status ${loginRes3.status}`)
    } else {
      fail('Old password', `should have been rejected, got ${loginRes3.status}`)
    }

    // ── 11. Reusing the same token must fail (idempotency) ──
    console.log('\n── 11. Reused token must fail ──')
    const reuseRes = await fetch(`${API}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: rawToken, password: 'Another$Pass99' }),
    })
    if (reuseRes.status >= 400) {
      pass('Used token rejected on replay', `status ${reuseRes.status}`)
    } else {
      fail('Used token replay', 'should have been rejected')
    }

    // ── 12. Expired token must fail ──
    console.log('\n── 12. Expired token must fail ──')
    const expiredToken = crypto.randomBytes(32).toString('hex')
    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(expiredToken),
        expiresAt: new Date(Date.now() - 60_000), // 1 min ago
      },
    })
    const expiredRes = await fetch(`${API}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: expiredToken, password: 'Another$Pass99' }),
    })
    if (expiredRes.status >= 400) {
      pass('Expired token rejected', `status ${expiredRes.status}`)
    } else {
      fail('Expired token', 'should have been rejected')
    }

  } finally {
    // ── Cleanup ──
    console.log('\n── Cleanup — delete test user ──')
    if (userId) {
      await prisma.passwordReset.deleteMany({ where: { userId } }).catch(() => {})
      await prisma.refreshToken.deleteMany({ where: { userId } }).catch(() => {})
      await prisma.user.delete({ where: { id: userId } }).catch(() => {})
      console.log(`  🧹 Deleted test user ${testEmail}`)
    }
  }

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════════════════════')
  const passed = results.filter((r) => r.status === 'PASS').length
  const failed = results.filter((r) => r.status === 'FAIL').length
  console.log(`  RESULT: ${passed} passed, ${failed} failed`)
  console.log('═══════════════════════════════════════════════════════════')
  process.exit(failed > 0 ? 1 : 0)
}

main()
  .catch((e) => { console.error('ERROR:', e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
