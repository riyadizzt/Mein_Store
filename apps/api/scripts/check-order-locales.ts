/**
 * Diagnostic: compare notes.locale (checkout language) vs user.preferredLang
 * (profile language) for recent orders. When they differ, the email
 * listener currently picks user.preferredLang — which is the bug
 * reported on 14.04.2026 (customer ordered in Arabic, got German mails).
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
      userId: { not: null },
    },
    include: {
      user: { select: { email: true, preferredLang: true, passwordHash: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  console.log(`Checked ${orders.length} orders from last 48h\n`)
  let mismatches = 0

  for (const o of orders) {
    let notesLocale: string | null = null
    try {
      const n = JSON.parse(o.notes ?? '{}')
      notesLocale = n.locale ?? null
    } catch {}

    const profileLang = o.user?.preferredLang ?? null
    const mismatch = notesLocale && profileLang && notesLocale !== profileLang
    const isStub = o.user && !o.user.passwordHash

    if (mismatch || !notesLocale) {
      mismatches++
      const marker = mismatch ? '⚠ MISMATCH' : '? no-notes-locale'
      console.log(`${marker}  ${o.orderNumber}  [${o.status}]`)
      console.log(`  user:          ${o.user?.email}  (${isStub ? 'STUB' : 'REGISTERED'})`)
      console.log(`  notes.locale:  ${notesLocale ?? 'null'}`)
      console.log(`  preferredLang: ${profileLang ?? 'null'}`)
      console.log(`  email sent in: ${profileLang ?? 'de'}  ← what the listener picked`)
      console.log(`  should be:     ${notesLocale ?? profileLang ?? 'de'}  ← what the customer expected`)
      console.log()
    }
  }

  console.log(`\n${mismatches} order(s) where emails went out in wrong language or unclear`)
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
