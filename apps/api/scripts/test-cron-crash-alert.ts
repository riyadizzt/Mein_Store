/**
 * Proves whether an uncaught cron crash triggers an admin alert.
 *
 * Methodology:
 *   1. Bootstrap the NestJS app (real scheduler + real services)
 *   2. Snapshot admin notifications count BEFORE
 *   3. Invoke the real PaymentTimeoutCron method directly with a rigged
 *      Prisma client that throws on the first DB call (simulates DB outage)
 *   4. Wait for any async side-effects
 *   5. Snapshot admin notifications count AFTER
 *   6. Check: did a new "cron_crashed" or similar notification appear?
 *
 * Read-only — creates no test data, modifies nothing.
 */

// Load .env
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
try {
  const envText = readFileSync(resolvePath(__dirname, '../.env'), 'utf8')
  for (const line of envText.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(m[1] in process.env)) process.env[m[1]] = v
  }
} catch {}

import { PrismaClient } from '@prisma/client'

const distBase = '../dist/apps/api/src'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NestFactory } = require('@nestjs/core')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require(`${distBase}/app.module`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PaymentTimeoutCron } = require(`${distBase}/modules/admin/cron/payment-timeout.cron`)

const prisma = new PrismaClient()

const color = (c: string, s: string) => `\x1b[${c}m${s}\x1b[0m`
const green = (s: string) => color('32', s)
const red = (s: string) => color('31', s)
const amber = (s: string) => color('33', s)
const dim = (s: string) => color('2', s)

async function countAdminNotifications(since: Date): Promise<number> {
  return prisma.notification.count({
    where: { createdAt: { gte: since } },
  })
}

async function run() {
  console.log('\n════════════════════════════════════════════════════════')
  console.log('  CRON-CRASH ALERT TEST')
  console.log('════════════════════════════════════════════════════════\n')

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] })
  const cron = app.get(PaymentTimeoutCron)

  // ── Before snapshot ──
  const beforeAt = new Date()
  const countBefore = await countAdminNotifications(beforeAt)
  console.log(`${dim('[1/4]')} Admin-Notifications vor dem Crash: ${countBefore}`)

  // ── Rig the cron's internal prisma to throw ──
  // PaymentTimeoutCron holds `private readonly prisma: PrismaService`.
  // We replace the findMany method with a throwing stub for this ONE call.
  const realPrisma = (cron as any).prisma
  const originalFindMany = realPrisma.order.findMany
  const simulatedError = new Error('SIMULATED CRON CRASH: DB connection dropped')

  realPrisma.order.findMany = async () => {
    throw simulatedError
  }
  console.log(`${dim('[2/4]')} Prisma rigged — ${amber('order.findMany() will throw')}`)

  // ── Invoke the cron method directly ──
  // We do NOT wait for the @Cron-scheduled tick — we call the method
  // ourselves. This exactly simulates "what happens when the scheduled
  // cron runs and hits an error".
  console.log(`${dim('[3/4]')} Invoking cleanupTimedOutOrders()...`)

  let cronThrew = false
  let cronCrashMessage: string | null = null
  try {
    await cron.cleanupTimedOutOrders()
  } catch (e: any) {
    cronThrew = true
    cronCrashMessage = e?.message ?? String(e)
  } finally {
    // Restore the real prisma method
    realPrisma.order.findMany = originalFindMany
  }

  if (cronThrew) {
    console.log(`       ${red('✗')} cron method bubbled up an error: ${dim(cronCrashMessage!)}`)
  } else {
    console.log(`       ${green('✓')} cron method returned normally (error was swallowed internally)`)
  }

  // ── After snapshot ──
  await new Promise((r) => setTimeout(r, 500)) // allow any fire-and-forget notify
  const countAfter = await countAdminNotifications(beforeAt)
  console.log(`\n${dim('[4/4]')} Admin-Notifications nach dem Crash: ${countAfter}`)

  const newNotifs = countAfter - countBefore
  console.log(`        ${newNotifs > 0 ? green(`+${newNotifs}`) : red(`${newNotifs} (keine neue)`)}`)

  // If any new notifications appeared, show them
  if (newNotifs > 0) {
    const rows = await prisma.notification.findMany({
      where: { createdAt: { gte: beforeAt } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { type: true, title: true, body: true, createdAt: true },
    })
    console.log('\n  Neue Notifications:')
    for (const r of rows) {
      console.log(`    - [${r.type}] ${r.title}`)
      if (r.body) console.log(`      ${dim(r.body)}`)
    }
  }

  // ── Verdict ──
  console.log('\n════════════════════════════════════════════════════════')
  console.log('  VERDICT')
  console.log('════════════════════════════════════════════════════════\n')

  if (newNotifs > 0) {
    console.log(green('  ✅ Cron-Crash → Admin wird benachrichtigt'))
    console.log(`     ${newNotifs} Notification(s) wurden nach dem Crash erstellt.`)
  } else if (cronThrew) {
    console.log(red('  ❌ Cron-Crash → KEIN Admin-Alert'))
    console.log(`     Der Cron hat die Exception bis an NestJS propagiert.`)
    console.log(`     NestJS loggt es, aber ${red('keine')} Notification wurde erstellt.`)
    console.log(`     Admin bemerkt den Crash nur wenn er die Server-Logs prüft.`)
  } else {
    console.log(amber('  ⚠️  Cron hat den Fehler INTERN gefangen'))
    console.log(`     Kein Propagate an NestJS, kein Crash — aber auch kein Alert.`)
    console.log(`     Der Cron ist robust gegen Einzelfehler, aber hätte eine`)
    console.log(`     DB-Totalausfall-Situation ebenso stumm verarbeitet.`)
  }

  console.log()

  await app.close()
  await prisma.$disconnect()
}

run().catch(async (e) => {
  console.error('\nFatal:', e)
  await prisma.$disconnect()
  process.exit(1)
})
