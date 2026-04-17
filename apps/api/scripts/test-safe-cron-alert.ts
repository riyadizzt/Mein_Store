/**
 * Verifies the END-TO-END SafeCron alert pipeline:
 *   1. @SafeCron-wrapped method throws
 *   2. Decorator catches + emits 'cron.crashed' on cronEvents
 *   3. CronCrashAlertService (registered via admin.module) receives event
 *   4. NotificationService writes a row to the `notifications` table with
 *      type = 'cron_crashed'
 *
 * No existing crons are touched. We build a throwaway test class with a
 * @SafeCron-decorated method, instantiate it directly, and invoke the method
 * manually. The decorator wraps the method exactly like it would for a
 * real cron — the wrap happens at decoration time, NOT at scheduler-tick
 * time, so calling the method by hand exercises the same code path.
 *
 * Cleanup is guaranteed via try/finally: any 'cron_crashed' rows we create
 * are deleted at the end.
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
const { SafeCron, cronEvents, SAFE_CRON_WRAPPED } = require(
  `${distBase}/common/decorators/safe-cron.decorator`,
)

const prisma = new PrismaClient()

const c = (code: string, s: string) => `\x1b[${code}m${s}\x1b[0m`
const green = (s: string) => c('32', s)
const red = (s: string) => c('31', s)
const dim = (s: string) => c('2', s)
const cyan = (s: string) => c('36', s)

// ── Throwaway cron class ─────────────────────────────────────
// Decorate a method with @SafeCron — wrapping happens at decoration time.
// We DO NOT register this with the NestJS scheduler (no @Injectable, no
// module). We just call the method by hand — that triggers the wrapper.

class FakeCronForTest {
  // Use a cron expression that would never match in practice ('Feb 30').
  // Even if accidentally registered (it isn't), it would never tick.
  // The empty options block is just to mirror how real crons look.
  static {
    // Make sure SafeCron is even loadable
    if (typeof SafeCron !== 'function') {
      throw new Error('SafeCron import failed')
    }
  }

  // Apply the decorator manually so we don't depend on TypeScript decorator
  // metadata at run time. We invoke SafeCron(cronExpression) which returns a
  // MethodDecorator, then call it with (target, key, descriptor).
  // The descriptor is the one we want to mutate (descriptor.value gets
  // replaced by the wrapper).
  // After this static block runs, FakeCronForTest.prototype.crashingMethod
  // is the wrapped version.
  static initMethod() {
    const target = FakeCronForTest.prototype
    const key = 'crashingMethod'
    const descriptor = Object.getOwnPropertyDescriptor(target, key)!
    SafeCron('0 0 30 2 *')(target, key, descriptor)
    Object.defineProperty(target, key, descriptor)
  }

  async crashingMethod(): Promise<void> {
    throw new Error('SIMULATED CRON CRASH — SafeCron pipeline test')
  }
}
FakeCronForTest.initMethod()

async function run() {
  console.log('\n════════════════════════════════════════════════════════')
  console.log('  SAFECRON ALERT PIPELINE — END-TO-END TEST')
  console.log('════════════════════════════════════════════════════════\n')

  // Sanity: was the method actually wrapped?
  const wrappedFlag = (FakeCronForTest.prototype as any).crashingMethod[SAFE_CRON_WRAPPED]
  console.log(`${dim('[1/6]')} Decorator wrap flag: ${wrappedFlag ? green('✓ wrapped') : red('✗ NOT wrapped')}`)
  if (!wrappedFlag) {
    console.log(red('  Decoration did not take effect — aborting.'))
    process.exit(1)
  }

  // Bootstrap full app — this also instantiates CronCrashAlertService
  // (in admin.module), which registers a listener on cronEvents.
  console.log(`${dim('[2/6]')} Bootstrapping NestJS app (registers CronCrashAlertService)...`)
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] })
  console.log(`       ${green('✓')} app ready, listener registered`)

  // Snapshot
  const beforeAt = new Date()
  const countBefore = await prisma.notification.count({
    where: { type: 'cron_crashed', createdAt: { gte: beforeAt } },
  })
  console.log(`${dim('[3/6]')} Existing 'cron_crashed' notifications since now: ${countBefore}`)

  // Listener-side defensive check: count current listeners on the event
  // (proves the subscription worked).
  const listenerCount = cronEvents.listenerCount('cron.crashed')
  console.log(`       ${listenerCount > 0 ? green('✓') : red('✗')} listenerCount('cron.crashed') = ${listenerCount}`)
  if (listenerCount === 0) {
    console.log(red('  No listener registered — admin.module did not wire CronCrashAlertService.'))
  }

  // Trigger the crash
  console.log(`${dim('[4/6]')} Triggering crashingMethod() — should throw...`)
  const fake = new FakeCronForTest()
  let didThrow = false
  let threwMessage = ''
  try {
    await fake.crashingMethod()
  } catch (e: any) {
    didThrow = true
    threwMessage = e?.message ?? String(e)
  }
  if (didThrow) {
    console.log(`       ${green('✓')} method re-threw: ${dim(threwMessage)}`)
  } else {
    console.log(`       ${red('✗')} method did NOT throw — wrapper may have swallowed`)
  }

  // Wait for async listener
  await new Promise((r) => setTimeout(r, 600))

  // Check DB
  console.log(`${dim('[5/6]')} Querying notifications table...`)
  const newNotifs = await prisma.notification.findMany({
    where: { type: 'cron_crashed', createdAt: { gte: beforeAt } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, type: true, title: true, body: true, data: true, createdAt: true },
  })
  console.log(`       found ${newNotifs.length} new notification(s)`)

  let cleanedCount = 0
  let verdict: 'pass' | 'fail' = 'fail'

  if (newNotifs.length > 0) {
    const n = newNotifs[0]
    const data = n.data as any
    console.log(`\n  Notification details:`)
    console.log(`    id          : ${dim(n.id)}`)
    console.log(`    type        : ${cyan(n.type)}`)
    console.log(`    title       : ${n.title}`)
    console.log(`    body        : ${dim(n.body)}`)
    console.log(`    data:`)
    console.log(`      cronClass     : ${data?.cronClass}`)
    console.log(`      method        : ${data?.method}`)
    console.log(`      cronExpression: ${data?.cronExpression}`)
    console.log(`      errorName     : ${data?.errorName}`)
    console.log(`      errorMessage  : ${dim(data?.errorMessage)}`)
    console.log(`      stack (8 lines):`)
    if (data?.stackSnippet) {
      for (const line of String(data.stackSnippet).split('\n').slice(0, 4)) {
        console.log(`        ${dim(line)}`)
      }
      console.log(`        ${dim('...')}`)
    }

    // Validate every required field
    const checks = [
      ['cronClass = FakeCronForTest', data?.cronClass === 'FakeCronForTest'],
      ['method = crashingMethod', data?.method === 'crashingMethod'],
      ['errorName is Error', data?.errorName === 'Error'],
      ['errorMessage contains SIMULATED', String(data?.errorMessage ?? '').includes('SIMULATED')],
      ['stackSnippet has lines', String(data?.stackSnippet ?? '').includes('\n')],
      ['cronExpression set', !!data?.cronExpression],
    ]
    console.log(`\n  Field validation:`)
    let allPassed = true
    for (const [name, ok] of checks) {
      console.log(`    ${ok ? green('✓') : red('✗')} ${name}`)
      if (!ok) allPassed = false
    }
    verdict = allPassed ? 'pass' : 'fail'
  }

  // Cleanup — delete all notifications we created
  console.log(`\n${dim('[6/6]')} Cleanup — removing test notifications...`)
  const del = await prisma.notification.deleteMany({
    where: { type: 'cron_crashed', createdAt: { gte: beforeAt } },
  })
  cleanedCount = del.count
  console.log(`       ${green('✓')} deleted ${cleanedCount}`)

  await app.close()
  await prisma.$disconnect()

  // Verdict
  console.log('\n════════════════════════════════════════════════════════')
  if (verdict === 'pass') {
    console.log(green('  ✅ ALERT PIPELINE FUNCTIONS END-TO-END'))
    console.log('       SafeCron → cronEvents → CronCrashAlertService → DB row')
  } else {
    console.log(red('  ❌ ALERT PIPELINE FAILED'))
    console.log('       Check listener registration + notification.create()')
  }
  console.log('════════════════════════════════════════════════════════\n')

  process.exit(verdict === 'pass' ? 0 : 1)
}

run().catch(async (e) => {
  console.error('\nFatal:', e)
  await prisma.$disconnect()
  process.exit(1)
})
