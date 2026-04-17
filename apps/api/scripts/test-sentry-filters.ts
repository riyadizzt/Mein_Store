/**
 * Sentry filter-chain test — proves that beforeSend + beforeSendTransaction
 * in sentry.init.ts correctly drop expected noise (400/401/404/429,
 * AccountBlocked, /health traces) while letting real errors pass through.
 *
 * Strategy:
 *   1. Set SENTRY_DSN to a bogus-but-valid DSN so the SDK actually
 *      initializes. No events ever leave the machine — we inspect the
 *      beforeSend callbacks directly, not the transport.
 *   2. Import sentry.init (triggers Sentry.init with the production config)
 *   3. Grab client.getOptions().beforeSend + beforeSendTransaction
 *   4. Invoke each with crafted fake events
 *   5. Assert return value (null = filtered, event = passes through)
 *
 * This test does NOT touch the network, the DB, or any live service.
 * Runs in under 2 seconds.
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

// Force a dummy DSN so Sentry.init() runs. The DSN points at a bogus
// project ID on sentry.io — the SDK validates the format, never connects.
process.env.SENTRY_DSN = 'https://filter-test@o0.ingest.sentry.io/0'

const distBase = '../dist/apps/api/src'
// eslint-disable-next-line @typescript-eslint/no-require-imports
require(`${distBase}/sentry.init`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Sentry = require('@sentry/nestjs')

const c = (code: string, s: string) => `\x1b[${code}m${s}\x1b[0m`
const green = (s: string) => c('32', s)
const red = (s: string) => c('31', s)
const dim = (s: string) => c('2', s)
const cyan = (s: string) => c('36', s)

type Result = { name: string; expected: 'drop' | 'pass'; actual: 'drop' | 'pass'; ok: boolean }
const results: Result[] = []

function check(name: string, expected: 'drop' | 'pass', returned: any) {
  const actual: 'drop' | 'pass' = returned === null ? 'drop' : 'pass'
  const ok = actual === expected
  results.push({ name, expected, actual, ok })
  const mark = ok ? green('✓') : red('✗')
  console.log(`  ${mark} ${name.padEnd(54)} expected=${expected} actual=${actual}`)
}

function main() {
  console.log('\n════════════════════════════════════════════════════════')
  console.log('  SENTRY FILTER-CHAIN TEST')
  console.log('════════════════════════════════════════════════════════\n')

  const client = Sentry.getClient()
  if (!client) {
    console.log(red('✗ Sentry client not initialized — aborting'))
    process.exit(1)
  }

  const opts = client.getOptions()
  const beforeSend = opts.beforeSend as (e: any, h: any) => any | null
  const beforeSendTransaction = opts.beforeSendTransaction as (e: any) => any | null

  if (typeof beforeSend !== 'function' || typeof beforeSendTransaction !== 'function') {
    console.log(red('✗ beforeSend or beforeSendTransaction missing on client — aborting'))
    process.exit(1)
  }

  console.log(cyan('── beforeSend (Error-Events) ──────────────────────────'))

  // ── DROPS: expected noise ──
  check(
    '400 BadRequest (class-validator)',
    'drop',
    beforeSend({}, { originalException: { status: 400, message: 'validation failed' } }),
  )
  check(
    '401 Unauthorized',
    'drop',
    beforeSend({}, { originalException: { status: 401, message: 'unauthorized' } }),
  )
  check(
    '404 Not Found',
    'drop',
    beforeSend({}, { originalException: { status: 404, message: 'not found' } }),
  )
  check(
    '429 Throttler',
    'drop',
    beforeSend({}, { originalException: { status: 429, message: 'rate limited' } }),
  )
  check(
    'status from contexts.response (e.g. 401 via ctx)',
    'drop',
    beforeSend(
      { contexts: { response: { status_code: 401 } } },
      { originalException: new Error('some wrapped error') },
    ),
  )
  check(
    'ForbiddenException with AccountBlocked structured body',
    'drop',
    beforeSend(
      {},
      {
        originalException: {
          status: 403,
          response: { statusCode: 403, error: 'AccountBlocked', message: 'blocked' },
        },
      },
    ),
  )

  // ── PASSES: real errors ──
  check(
    '500 Internal Server Error (real crash)',
    'pass',
    beforeSend(
      { exception: { values: [{ type: 'Error', value: 'boom' }] } },
      { originalException: new Error('boom') },
    ),
  )
  check(
    'Uncaught TypeError (no status)',
    'pass',
    beforeSend(
      { exception: { values: [{ type: 'TypeError' }] } },
      { originalException: new TypeError('x is undefined') },
    ),
  )
  check(
    '403 Forbidden (NO AccountBlocked) — real permission issue',
    'pass',
    beforeSend(
      {},
      {
        originalException: {
          status: 403,
          response: { statusCode: 403, error: 'Forbidden', message: 'insufficient permissions' },
        },
      },
    ),
  )
  check(
    '500 with JSON response body (DB failure)',
    'pass',
    beforeSend(
      { contexts: { response: { status_code: 500 } } },
      {
        originalException: {
          status: 500,
          response: { statusCode: 500, error: 'InternalError' },
        },
      },
    ),
  )

  console.log('\n' + cyan('── beforeSendTransaction (Performance) ────────────────'))

  check(
    'Health endpoint via transaction name',
    'drop',
    beforeSendTransaction({
      transaction: 'GET /api/v1/health',
      request: { url: 'http://localhost:3001/api/v1/health' },
    }),
  )
  check(
    'Health endpoint via URL fallback',
    'drop',
    beforeSendTransaction({
      transaction: 'some-other-name',
      request: { url: 'http://localhost:3001/api/v1/health' },
    }),
  )
  check(
    '/api/v1/orders (normal route)',
    'pass',
    beforeSendTransaction({
      transaction: 'GET /api/v1/orders',
      request: { url: 'http://localhost:3001/api/v1/orders' },
    }),
  )

  // URL redaction check — this returns the (possibly modified) event
  const tx = beforeSendTransaction({
    transaction: 'POST /api/v1/auth/reset-password',
    request: {
      url: 'http://localhost:3001/api/v1/auth/reset-password?token=abc123secret&foo=bar',
    },
  })
  const url = tx?.request?.url ?? ''
  const urlOk = url.includes('token=[REDACTED]') && !url.includes('abc123secret') && url.includes('foo=bar')
  results.push({
    name: 'URL redaction (token=…secret → [REDACTED])',
    expected: 'pass',
    actual: urlOk ? 'pass' : 'drop',
    ok: urlOk,
  })
  console.log(
    `  ${urlOk ? green('✓') : red('✗')} URL redaction (token=…secret → [REDACTED])          ${dim('result: ' + url)}`,
  )

  // ── Summary ──────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════')
  const passed = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length
  if (failed === 0) {
    console.log(green(`  ✅ ALL FILTERS WORK — ${passed}/${results.length} checks passed`))
  } else {
    console.log(red(`  ❌ ${failed} of ${results.length} FAILED`))
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`     - ${r.name}: expected ${r.expected} got ${r.actual}`)
    }
  }
  console.log('════════════════════════════════════════════════════════\n')

  // Flush Sentry so any queued SDK init work completes cleanly before exit
  void Sentry.close?.(2000)
  process.exit(failed > 0 ? 1 : 0)
}

main()
