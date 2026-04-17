/**
 * Live webhook delivery test — posts an actual HTTP request to a real URL
 * (n8n cloud, webhook.site, or anything else) using the REAL HMAC signature
 * that the production worker would produce.
 *
 * Why this exists:
 *   - Dev-mode in this project uses a NoOpQueue, so nothing is actually
 *     delivered over the wire. The E2E test (`test-webhook-e2e.ts`) verifies
 *     that the DB delivery log is created but stops there.
 *   - This script goes the last mile: it triggers an event through the
 *     real service, reads the generated payload back from the DB, and
 *     POSTs it live. No env changes, no admin-login breakage.
 *
 * Usage:
 *   npx tsx scripts/test-webhook-live.ts \
 *     --live-url=https://yourname.app.n8n.cloud/webhook-test/xxx \
 *     [--event=product.created]   # default
 *
 * Supported --event values:
 *   product.created              (default — full 3-lang payload)
 *   customer.registered
 *   contact.message_received
 *   inventory.restock
 *   synthetic                    (uses the admin "Send test event" flow)
 *
 * Requirements:
 *   1. API must be built (pnpm --filter @omnichannel/api build)
 *   2. .env must contain DATABASE_URL
 *   3. The live URL must accept POST with arbitrary JSON body
 *
 * Cleanup: guaranteed via try/finally — all test rows are deleted even
 * on abort, so the DB stays clean. Subscription + delivery log also wiped.
 */

// ── Boot: load .env ──────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
try {
  const envText = readFileSync(resolvePath(__dirname, '../.env'), 'utf8')
  for (const line of envText.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!m) continue
    const key = m[1]
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = val
  }
} catch {}

import { PrismaClient } from '@prisma/client'
import { randomUUID, createHmac } from 'node:crypto'

// Imports from built dist — metadata-preserving (see test-webhook-e2e.ts)
const distBase = '../dist/apps/api/src'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NestFactory } = require('@nestjs/core')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require(`${distBase}/app.module`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthService } = require(`${distBase}/modules/auth/auth.service`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ContactService } = require(`${distBase}/modules/contact/contact.service`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ProductsService } = require(`${distBase}/modules/products/products.service`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AdminInventoryService } = require(`${distBase}/modules/admin/services/admin-inventory.service`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { WebhookService } = require(`${distBase}/modules/webhooks/webhook.service`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { WebhookDispatcherService } = require(`${distBase}/modules/webhooks/webhook-dispatcher.service`)

// ── CLI parsing ──────────────────────────────────────────────
const args = process.argv.slice(2)
const getArg = (k: string) => {
  const hit = args.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : null
}
const liveUrl = getArg('live-url')
const eventChoice = (getArg('event') ?? 'product.created').toLowerCase()

if (!liveUrl) {
  console.error('\n❌ --live-url=<url> is required\n')
  console.error('Example:')
  console.error('  npx tsx scripts/test-webhook-live.ts \\')
  console.error('    --live-url=https://yourname.app.n8n.cloud/webhook-test/xxx \\')
  console.error('    --event=product.created\n')
  process.exit(1)
}

try {
  const parsed = new URL(liveUrl)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
} catch {
  console.error(`\n❌ Invalid --live-url: ${liveUrl}\n`)
  process.exit(1)
}

const SUPPORTED = [
  'product.created',
  'customer.registered',
  'contact.message_received',
  'inventory.restock',
  'synthetic',
]
if (!SUPPORTED.includes(eventChoice)) {
  console.error(`\n❌ Unsupported --event: ${eventChoice}`)
  console.error(`   Supported: ${SUPPORTED.join(', ')}\n`)
  process.exit(1)
}

// ── Helpers ──────────────────────────────────────────────────
const prisma = new PrismaClient()
const TEST_ID = `live${Date.now().toString(36)}${randomUUID().slice(0, 4)}`.toLowerCase()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function color(code: string, s: string) {
  return `\x1b[${code}m${s}\x1b[0m`
}
const green = (s: string) => color('32', s)
const red = (s: string) => color('31', s)
const cyan = (s: string) => color('36', s)
const dim = (s: string) => color('2', s)

/** Compute the same HMAC-SHA256 signature the production worker uses. */
function signPayload(secret: string, timestamp: string, rawBody: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
}

/**
 * Wait up to timeoutMs for a delivery log row matching the trigger.
 * Returns the full row (incl. payload JSONB) or null on timeout.
 */
async function waitForLog(
  subscriptionId: string,
  eventType: string,
  beforeAt: Date,
  timeoutMs = 5000,
): Promise<any | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const log = await prisma.webhookDeliveryLog.findFirst({
      where: { subscriptionId, eventType, createdAt: { gt: beforeAt } },
      orderBy: { createdAt: 'desc' },
    })
    if (log) return log
    await sleep(150)
  }
  return null
}

// ── Main ─────────────────────────────────────────────────────
async function run() {
  console.log('\n════════════════════════════════════════════════════════')
  console.log('  LIVE WEBHOOK DELIVERY TEST')
  console.log('════════════════════════════════════════════════════════')
  console.log(`  target  : ${cyan(liveUrl!)}`)
  console.log(`  event   : ${cyan(eventChoice)}`)
  console.log(`  test-id : ${dim(TEST_ID)}`)
  console.log('')

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] })

  const auth = app.get(AuthService)
  const contact = app.get(ContactService)
  const products = app.get(ProductsService)
  const inventory = app.get(AdminInventoryService)
  const webhooks = app.get(WebhookService)
  const dispatcher = app.get(WebhookDispatcherService)

  const created = {
    subId: null as string | null,
    userId: null as string | null,
    productId: null as string | null,
    variantIds: [] as string[],
    inventoryIds: [] as string[],
    contactIds: [] as string[],
  }

  let exitCode = 0

  try {
    // 1. Create a one-shot subscription pointing at the real URL so the
    //    webhook module builds a payload as if it were going to n8n anyway.
    console.log(`${dim('[1/5]')} Creating test subscription...`)
    const eventList = eventChoice === 'synthetic' ? ['order.created'] : [eventChoice]
    const sub = await webhooks.create({
      url: liveUrl,
      events: eventList,
      description: `Live test ${TEST_ID}`,
    })
    created.subId = sub.id
    console.log(`       ${green('✓')} subscription ${dim(sub.id.slice(0, 8))}`)
    console.log(`       secret: ${dim(sub.secret.slice(0, 16) + '…')}`)

    // 2. Fire the event through the real service so the payload is
    //    constructed by the real builder in the real module.
    console.log(`\n${dim('[2/5]')} Triggering event ${cyan(eventChoice)}...`)
    const beforeAt = new Date()

    switch (eventChoice) {
      case 'customer.registered': {
        const email = `live-${TEST_ID}@example.test`
        await auth.register({
          email,
          password: 'TestPass123!',
          firstName: 'LiveTest',
          lastName: 'User',
          gdprConsent: true,
        })
        const u = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
        if (u) created.userId = u.id
        break
      }
      case 'contact.message_received': {
        const r = await contact.submit(
          {
            name: `Live ${TEST_ID}`,
            email: `live-contact-${TEST_ID}@example.test`,
            subject: 'Live webhook test',
            message: 'This is a live webhook delivery test',
            locale: 'de',
          } as any,
          { ipAddress: '127.0.0.1', userAgent: 'live-test' },
        )
        if (r?.id) created.contactIds.push(r.id)
        break
      }
      case 'product.created': {
        const cat = await prisma.category.findFirst({ where: { isActive: true } })
        if (!cat) throw new Error('No active category')
        const slug = `live-${TEST_ID}`
        const skuBase = `LIVE${TEST_ID.slice(-6).toUpperCase()}`
        const p = await products.create({
          slug,
          categoryId: cat.id,
          brand: 'Live Test',
          gender: 'unisex',
          basePrice: 49.99,
          salePrice: null,
          taxRate: 19,
          isActive: false,
          isFeatured: false,
          translations: [
            {
              language: 'de',
              name: `Live-Test-Produkt ${TEST_ID.slice(-4).toUpperCase()}`,
              description: 'Dies ist ein Live-Webhook-Test-Produkt. Premium-Qualität, einzigartiges Design, perfekt für die moderne Garderobe.',
            },
            {
              language: 'en',
              name: `Live Test Product ${TEST_ID.slice(-4).toUpperCase()}`,
              description: 'This is a live webhook test product. Premium quality, unique design, perfect for the modern wardrobe.',
            },
            {
              language: 'ar',
              name: `منتج اختبار ${TEST_ID.slice(-4).toUpperCase()}`,
              description: 'هذا منتج اختبار مباشر للويب هوك. جودة عالية، تصميم فريد، مثالي لخزانة الملابس الحديثة.',
            },
          ],
          variants: [
            {
              sku: `${skuBase}-BLU-M`,
              color: 'Blau',
              size: 'M',
              priceModifier: 0,
              initialStock: 10,
            } as any,
          ],
        } as any)
        created.productId = p.id
        created.variantIds = p.variants.map((v: any) => v.id)
        const inv = await prisma.inventory.findFirst({ where: { variantId: created.variantIds[0] } })
        if (inv) created.inventoryIds.push(inv.id)
        break
      }
      case 'inventory.restock': {
        // Uses an existing inventory row — fastest path
        const anyInv = await prisma.inventory.findFirst({ orderBy: { updatedAt: 'desc' } })
        if (!anyInv) throw new Error('No inventory row found')
        await inventory.intake(
          [{ inventoryId: anyInv.id, quantity: 1 }],
          'live-webhook-test',
          'live-admin',
          '127.0.0.1',
        )
        break
      }
      case 'synthetic': {
        // Admin "Send test event" flow — bypasses all business side-effects,
        // creates a synthetic log row directly. Useful for URL smoke-tests.
        await dispatcher.sendTestEvent(sub.id)
        break
      }
    }
    console.log(`       ${green('✓')} trigger executed`)

    // 3. Wait for delivery-log row
    const emittedType = eventChoice === 'synthetic' ? 'order.created' : eventChoice
    console.log(`\n${dim('[3/5]')} Waiting for delivery log...`)
    const log = await waitForLog(sub.id, emittedType, beforeAt)
    if (!log) {
      console.log(`       ${red('✗')} No delivery log created within 5s — the emit did not fire.`)
      exitCode = 1
      return
    }
    console.log(`       ${green('✓')} log ${dim(log.id.slice(0, 8))} created (${log.eventType})`)

    // 4. Sign + POST to the real URL. Same signature scheme as webhook.worker.
    console.log(`\n${dim('[4/5]')} Sending POST to live URL...`)
    const rawBody = JSON.stringify(log.payload)
    const timestamp = String(Date.now())
    const signature = signPayload(sub.secret, timestamp, rawBody)

    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Malak-Signature': signature,
      'X-Malak-Timestamp': timestamp,
      'X-Malak-Event-Id': log.eventId,
      'X-Malak-Event-Type': log.eventType,
      'User-Agent': 'MalakWebhooks/1.0 (live-test)',
    }

    let httpStatus = 0
    let responseBody = ''
    let networkError: string | null = null

    const started = Date.now()
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)
      try {
        const res = await fetch(liveUrl!, {
          method: 'POST',
          headers,
          body: rawBody,
          signal: controller.signal,
        })
        httpStatus = res.status
        responseBody = await res.text().catch(() => '')
      } finally {
        clearTimeout(timer)
      }
    } catch (e: any) {
      networkError = e?.name === 'AbortError' ? 'Timeout after 10s' : e?.message ?? String(e)
    }
    const elapsed = Date.now() - started

    console.log(`       elapsed: ${dim(`${elapsed}ms`)}`)
    if (networkError) {
      console.log(`       ${red('✗')} network error: ${networkError}`)
      exitCode = 1
    } else if (httpStatus >= 200 && httpStatus < 300) {
      console.log(`       ${green(`✓ HTTP ${httpStatus}`)}`)
    } else {
      console.log(`       ${red(`✗ HTTP ${httpStatus}`)}`)
      exitCode = 1
    }
    if (responseBody) {
      const preview = responseBody.length > 500 ? responseBody.slice(0, 500) + '…' : responseBody
      console.log(`       response: ${dim(preview)}`)
    }

    // 5. Summary + copyable payload preview
    console.log(`\n${dim('[5/5]')} Summary:`)
    console.log(`   headers sent:`)
    for (const [k, v] of Object.entries(headers)) {
      if (k === 'X-Malak-Signature') {
        console.log(`     ${k}: ${dim(v.slice(0, 30) + '…')}`)
      } else {
        console.log(`     ${k}: ${dim(v)}`)
      }
    }
    console.log(`\n   body (${rawBody.length} bytes):`)
    const bodyObj = JSON.parse(rawBody)
    console.log(
      dim(
        JSON.stringify(
          {
            id: bodyObj.id,
            type: bodyObj.type,
            created: bodyObj.created,
            apiVersion: bodyObj.apiVersion,
            'data.object': truncateForDisplay(bodyObj.data?.object),
          },
          null,
          2,
        ),
      ),
    )

    if (exitCode === 0) {
      console.log(`\n${green('✓ Live delivery succeeded.')}`)
      console.log(`  Check your n8n "Executions" tab — the payload above was received.`)
      console.log(`  Verify HMAC in n8n via:`)
      console.log(`    expectedSig = 'sha256=' + crypto`)
      console.log(`      .createHmac('sha256', <your-secret>)`)
      console.log(`      .update(headers['x-malak-timestamp'] + '.' + rawBody)`)
      console.log(`      .digest('hex')`)
    } else {
      console.log(`\n${red('✗ Live delivery failed.')}`)
      console.log(`  Possible causes:`)
      console.log(`    - n8n "Listen for test event" timed out (60s window) — re-arm it and retry`)
      console.log(`    - The URL path is wrong (test-URL vs production-URL)`)
      console.log(`    - n8n requires auth (set Authentication: None in the Webhook node)`)
      console.log(`    - HTTPS cert issue (check URL scheme)`)
    }
  } catch (e: any) {
    console.error(`\n${red('✗ Fatal:')} ${e?.message ?? e}`)
    exitCode = 1
  } finally {
    // ── Cleanup ─────────────────────────────────────────────
    console.log('\n── Cleanup ────────────────────────────────────────')
    try {
      if (created.contactIds.length) {
        await prisma.contactMessage.deleteMany({ where: { id: { in: created.contactIds } } })
      }
      if (created.productId) {
        await prisma.inventory.deleteMany({ where: { variantId: { in: created.variantIds } } })
        await prisma.productTranslation.deleteMany({ where: { productId: created.productId } })
        await prisma.productVariant.deleteMany({ where: { productId: created.productId } })
        await prisma.product.delete({ where: { id: created.productId } }).catch(() => {})
      }
      if (created.userId) {
        await prisma.gdprConsent.deleteMany({ where: { userId: created.userId } })
        await prisma.user.delete({ where: { id: created.userId } }).catch(() => {})
      }
      if (created.subId) {
        const del = await prisma.webhookDeliveryLog.deleteMany({
          where: { subscriptionId: created.subId },
        })
        await prisma.webhookSubscription.delete({ where: { id: created.subId } }).catch(() => {})
        console.log(`  ${green('✓')} removed subscription + ${del.count} log(s) + test rows`)
      } else {
        console.log(`  ${green('✓')} nothing to clean up`)
      }
    } catch (e: any) {
      console.log(`  ⚠️  cleanup warning: ${e?.message ?? e}`)
    }
  }

  await app.close()
  await prisma.$disconnect()
  process.exit(exitCode)
}

function truncateForDisplay(obj: any, depth = 0): any {
  if (depth > 3) return '...'
  if (obj == null) return obj
  if (Array.isArray(obj)) {
    if (obj.length === 0) return []
    return [truncateForDisplay(obj[0], depth + 1), obj.length > 1 ? `+${obj.length - 1} more` : null].filter(Boolean)
  }
  if (typeof obj === 'object') {
    const out: any = {}
    const keys = Object.keys(obj)
    for (const k of keys) {
      const v = obj[k]
      if (typeof v === 'string' && v.length > 80) {
        out[k] = v.slice(0, 80) + '…'
      } else {
        out[k] = truncateForDisplay(v, depth + 1)
      }
    }
    return out
  }
  return obj
}

run().catch(async (e) => {
  console.error(red('\nFatal outer:'), e)
  await prisma.$disconnect()
  process.exit(1)
})
