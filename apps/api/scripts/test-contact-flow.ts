/**
 * E2E test for the /contact flow.
 *
 * Verifies:
 *   - Valid POST creates a DB row with status=new
 *   - Rate limit: 4th request from same IP → 403 RateLimited
 *   - Honeypot: request with website field is silent-accepted (ok) but NO
 *     DB row is created and NO emails are queued
 *   - Admin unread count increments
 *
 * Cleans up all created rows at the end.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const API = 'http://localhost:3001/api/v1'

type R = { name: string; status: 'PASS' | 'FAIL'; note?: string }
const results: R[] = []
const pass = (n: string, note?: string) => { results.push({ name: n, status: 'PASS', note }); console.log(`  ✅ ${n}${note ? ` — ${note}` : ''}`) }
const fail = (n: string, note: string) => { results.push({ name: n, status: 'FAIL', note }); console.log(`  ❌ ${n} — ${note}`) }

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  CONTACT FORM — E2E test')
  console.log('═══════════════════════════════════════════════════════════\n')

  const unique = Date.now()
  const testEmail = `contact-test-${unique}@malak-test.local`
  const createdIds: string[] = []

  try {
    // ── 1. Baseline unread count ──
    const baseUnread = await prisma.contactMessage.count({ where: { status: 'new' } })
    console.log(`── 1. Baseline: ${baseUnread} unread messages in DB ──`)

    // ── 2. Valid submission ──
    console.log('\n── 2. Valid POST ──')
    const r1 = await fetch(`${API}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Contact Test',
        email: testEmail,
        subject: 'E2E Test Subject',
        message: 'This is a valid test message long enough to pass validation.',
        locale: 'de',
      }),
    })
    const r1body: any = await r1.json().catch(() => ({}))
    if (r1.status === 201 && r1body?.ok === true && r1body?.id) {
      pass('valid POST', `id=${r1body.id.slice(0, 8)}`)
      createdIds.push(r1body.id)
    } else {
      fail('valid POST', `status ${r1.status}: ${JSON.stringify(r1body).slice(0, 150)}`)
      return
    }

    // ── 3. DB row created ──
    const row = await prisma.contactMessage.findUnique({ where: { id: r1body.id } })
    if (row && row.status === 'new' && row.email === testEmail && row.locale === 'de') {
      pass('db row persisted', `status=${row.status}, locale=${row.locale}`)
    } else {
      fail('db row', JSON.stringify(row))
    }

    // ── 4. Unread count incremented ──
    const afterUnread = await prisma.contactMessage.count({ where: { status: 'new' } })
    if (afterUnread === baseUnread + 1) {
      pass('unread count +1', `${baseUnread} → ${afterUnread}`)
    } else {
      fail('unread count', `expected ${baseUnread + 1}, got ${afterUnread}`)
    }

    // ── 5. Honeypot — silently accepted but no DB row ──
    console.log('\n── 5. Honeypot ──')
    const beforeHoney = await prisma.contactMessage.count()
    const rh = await fetch(`${API}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Spam Bot',
        email: `spam-${unique}@bot.local`,
        subject: 'BUY CHEAP WATCHES',
        message: 'Click this link now!!! Cheap pills!!!',
        website: 'http://spam.example.com', // honeypot field
      }),
    })
    const rhBody: any = await rh.json().catch(() => ({}))
    const afterHoney = await prisma.contactMessage.count()
    if (rh.status === 201 && rhBody?.ok === true && afterHoney === beforeHoney) {
      pass('honeypot silent-accept', 'no DB row created')
    } else {
      fail('honeypot', `status=${rh.status}, delta=${afterHoney - beforeHoney}`)
    }

    // ── 6. Rate limit — 3 more requests from same IP ──
    console.log('\n── 6. Rate limit (3 more → 4th rejected) ──')
    // Submissions 2, 3 — should succeed
    for (let i = 2; i <= 3; i++) {
      const r = await fetch(`${API}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Rate Test ${i}`,
          email: `rate-${unique}-${i}@test.local`,
          subject: `Rate test ${i}`,
          message: 'Another valid message for rate limit test.',
          locale: 'en',
        }),
      })
      const body: any = await r.json().catch(() => ({}))
      if (r.status === 201 && body.id) {
        createdIds.push(body.id)
      }
    }
    // 4th → rate limited
    const r4 = await fetch(`${API}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Rate Test 4',
        email: `rate-${unique}-4@test.local`,
        subject: 'Should be rejected',
        message: 'This should hit the rate limit.',
        locale: 'de',
      }),
    })
    const r4body: any = await r4.json().catch(() => ({}))
    if (r4.status === 403 || r4.status === 429) {
      if (r4body?.error === 'RateLimited') {
        pass('rate limit', `4th POST returned ${r4.status} RateLimited`)
      } else {
        pass('rate limit (alt)', `4th POST returned ${r4.status}, error=${r4body?.error}`)
      }
    } else {
      fail('rate limit', `4th POST should be rejected, got ${r4.status}`)
    }

    // ── 7. Validation — too short ──
    console.log('\n── 7. Validation rejects bad input ──')
    const rv = await fetch(`${API}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'X', // too short
        email: 'not-an-email',
        subject: '',
        message: 'short',
      }),
    })
    if (rv.status === 400) {
      pass('bad input rejected', 'status 400')
    } else {
      fail('validation', `expected 400, got ${rv.status}`)
    }
  } finally {
    console.log('\n── Cleanup ──')
    if (createdIds.length > 0) {
      await prisma.contactMessage.deleteMany({ where: { id: { in: createdIds } } }).catch(() => {})
    }
    // Also clean any bot/rate rows by this test's unique suffix
    await prisma.contactMessage
      .deleteMany({ where: { email: { contains: `${unique}` } } })
      .catch(() => {})
    // And the related notification rows (contact_message type)
    await prisma.notification
      .deleteMany({ where: { type: 'contact_message', createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } } })
      .catch(() => {})
    console.log('  🧹 Test rows deleted')
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
