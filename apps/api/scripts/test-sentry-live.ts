/**
 * End-to-end live test against the configured Sentry project.
 * Triggers a SYNTHETIC error + a captureMessage and waits for Sentry to
 * accept the events. Prints event IDs you can search for in the dashboard.
 *
 * Expects: SENTRY_DSN already set in apps/api/.env.
 * Safe: synthetic errors only. No business data touched, no DB writes.
 */

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

const distBase = '../dist/apps/api/src'
// eslint-disable-next-line @typescript-eslint/no-require-imports
require(`${distBase}/sentry.init`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Sentry = require('@sentry/nestjs')

const c = (code: string, s: string) => `\x1b[${code}m${s}\x1b[0m`
const green = (s: string) => c('32', s)
const red = (s: string) => c('31', s)
const cyan = (s: string) => c('36', s)
const dim = (s: string) => c('2', s)

async function main() {
  console.log('\n════════════════════════════════════════════════════════')
  console.log('  LIVE SENTRY TEST')
  console.log('════════════════════════════════════════════════════════\n')

  const client = Sentry.getClient()
  if (!client) {
    console.log(red('✗ Sentry not initialized — SENTRY_DSN missing?'))
    process.exit(1)
  }

  const dsn = client.getDsn()
  if (dsn) {
    console.log(`  DSN host  : ${cyan(dsn.host)}`)
    console.log(`  Project ID: ${cyan(dsn.projectId)}`)
  }
  console.log(`  Env       : ${cyan(client.getOptions().environment ?? 'unknown')}`)

  // ── Test 1: captureMessage (simple "I'm alive" event) ──
  console.log('\n[1/3] Sending captureMessage (info)...')
  const msgId = Sentry.captureMessage(
    'Malak Sentry live test — captureMessage at ' + new Date().toISOString(),
    {
      level: 'info',
      tags: { test_run: 'live-sanity-check' },
    },
  )
  console.log(`      event_id: ${dim(msgId ?? 'null')}`)

  // ── Test 2: captureException (real Error with stack) ──
  console.log('[2/3] Sending captureException with stack trace...')
  let exId: string | undefined
  try {
    throw new Error('Malak Sentry live test — synthetic error at ' + new Date().toISOString())
  } catch (e) {
    exId = Sentry.captureException(e, {
      tags: { test_run: 'live-sanity-check' },
    })
  }
  console.log(`      event_id: ${dim(exId ?? 'null')}`)

  // ── Test 3: captureException that SHOULD be filtered (401) ──
  console.log('[3/3] Sending 401-error (should be DROPPED by beforeSend)...')
  const filtered = Sentry.captureException(
    Object.assign(new Error('401 test — this should not arrive in Sentry'), { status: 401 }),
    { tags: { test_run: 'live-sanity-check' } },
  )
  console.log(`      event_id: ${dim(filtered ?? 'null')}`)
  console.log(dim(`      (Sentry returns an ID even for filtered events, but nothing is sent.)`))

  // ── Flush — force all queued events to be transmitted before exit ──
  console.log('\n  Flushing... (waits up to 5s for Sentry to accept)')
  const flushed = await Sentry.flush(5000)
  console.log(`  Flush result: ${flushed ? green('✓ all events transmitted') : red('✗ timeout — network issue?')}`)

  console.log('\n════════════════════════════════════════════════════════')
  if (flushed) {
    console.log(green('  ✅ Events sent to Sentry.'))
    console.log(`\n  Go to your Sentry dashboard:`)
    console.log(`    https://malak-bekleidung.sentry.io/issues/?project=${dsn?.projectId}`)
    console.log(`\n  Look for:`)
    console.log(`    • "captureMessage" event (info-level)`)
    console.log(`    • Synthetic Error with stack trace`)
    console.log(`    • NO 401-error (filter worked)`)
    console.log(`\n  Filter by tag: test_run:live-sanity-check`)
  } else {
    console.log(red('  ❌ Flush timed out.'))
    console.log('     Possible causes: invalid DSN, firewall, Sentry project paused.')
  }
  console.log('════════════════════════════════════════════════════════\n')

  await Sentry.close(2000)
  process.exit(flushed ? 0 : 1)
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
