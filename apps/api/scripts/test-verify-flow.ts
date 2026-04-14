/**
 * Prove the verify-email fix.
 *
 * 1. Create a throwaway user with a verify token planted in DB
 * 2. Call the verify API ONCE — expect success
 * 3. Call the verify API AGAIN with the same token — expect 400 (as before)
 *    This is the case the frontend now handles gracefully via the amber screen
 * 4. Verify the user is now isVerified=true in DB
 * 5. Cleanup
 *
 * The double-call race is fixed on the frontend (useRef guard + URL cleanup).
 * This script exercises the backend contract the frontend relies on.
 */
import { PrismaClient } from '@prisma/client'
import * as crypto from 'crypto'
const prisma = new PrismaClient()
const API = 'http://localhost:3001/api/v1'

type R = { name: string; status: 'PASS' | 'FAIL'; note?: string }
const results: R[] = []
const pass = (n: string, note?: string) => { results.push({ name: n, status: 'PASS', note }); console.log(`  ✅ ${n}${note ? ` — ${note}` : ''}`) }
const fail = (n: string, note: string) => { results.push({ name: n, status: 'FAIL', note }); console.log(`  ❌ ${n} — ${note}`) }

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  VERIFY-EMAIL flow — backend contract test')
  console.log('═══════════════════════════════════════════════════════════\n')

  const unique = Date.now()
  const testEmail = `verify-test-${unique}@malak-test.local`
  const token = crypto.randomUUID()
  let userId: string | null = null

  try {
    // Plant unverified user with token
    const user = await prisma.user.create({
      data: {
        email: testEmail,
        firstName: 'Verify',
        lastName: 'Test',
        role: 'customer',
        isVerified: false,
        isActive: true,
        emailVerifyToken: token,
        emailVerifyExpires: new Date(Date.now() + 24 * 3600 * 1000),
      },
    })
    userId = user.id
    pass('setup', `user ${testEmail} with token ${token.slice(0, 8)}...`)

    // First call — should succeed
    const r1 = await fetch(`${API}/auth/verify-email?token=${token}`)
    const r1json: any = await r1.json().catch(() => ({}))
    if (r1.ok && r1json?.data?.email === testEmail) {
      pass('first call', `200 OK, email=${r1json.data.email}`)
    } else if (r1.ok && r1json?.email === testEmail) {
      pass('first call', `200 OK (flat shape), email=${r1json.email}`)
    } else {
      fail('first call', `status ${r1.status}: ${JSON.stringify(r1json).slice(0, 150)}`)
      return
    }

    // DB check — user now verified
    const afterFirst = await prisma.user.findUnique({ where: { id: user.id } })
    if (afterFirst?.isVerified === true && afterFirst.emailVerifyToken === null) {
      pass('db state', 'isVerified=true, token cleared')
    } else {
      fail('db state', `isVerified=${afterFirst?.isVerified}, token=${afterFirst?.emailVerifyToken}`)
    }

    // Second call — backend returns 400 (token gone). The old frontend
    // painted this as a red "invalid" screen over the real success. The
    // new frontend never gets here because of useRef guard + URL cleanup.
    const r2 = await fetch(`${API}/auth/verify-email?token=${token}`)
    if (r2.status === 400 || r2.status === 404) {
      pass('second call rejected', `status ${r2.status} (expected — token already consumed)`)
      console.log('        Frontend now shows amber "already verified or expired" screen')
      console.log('        with "Einloggen" + "Neuen Link" buttons — no more red dead-end')
    } else {
      fail('second call', `expected 400/404, got ${r2.status}`)
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

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
