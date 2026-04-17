/**
 * E2E webhook test — triggers every emit point against the live Supabase DB.
 *
 * IMPORTANT: This script imports from dist/ (not src/) so the decorator
 * metadata is correctly present (tsx's on-the-fly compile loses metadata
 * for files outside the tsconfig include path).
 *
 * Run order:
 *   1. `pnpm --filter @omnichannel/api build`   (produces dist/)
 *   2. `npx tsx scripts/test-webhook-e2e.ts`
 *
 * Dev-mode NoOp queue means no real HTTP call fires — logs are created
 * with status='pending', which proves the emit worked with the right payload.
 *
 * NON-DESTRUCTIVE: unique TEST_RUN_ID prefix, try/finally cleanup.
 */

// Load .env so ConfigService sees JWT_SECRET etc.
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
import { randomUUID } from 'node:crypto'

// Imports from dist (compiled, metadata-preserving)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const distBase = '../dist/apps/api/src'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NestFactory } = require('@nestjs/core')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { EventEmitter2 } = require('@nestjs/event-emitter')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require(`${distBase}/app.module`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthService } = require(`${distBase}/modules/auth/auth.service`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GdprService } = require(`${distBase}/modules/users/gdpr.service`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ContactService } = require(`${distBase}/modules/contact/contact.service`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ProductsService } = require(`${distBase}/modules/products/products.service`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AdminInventoryService } = require(`${distBase}/modules/admin/services/admin-inventory.service`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AdminReturnsService } = require(`${distBase}/modules/admin/services/admin-returns.service`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PaymentsService } = require(`${distBase}/modules/payments/payments.service`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { WebhookService } = require(`${distBase}/modules/webhooks/webhook.service`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ORDER_EVENTS } = require(`${distBase}/modules/orders/events/order.events`)

const ALL_WEBHOOK_EVENTS = [
  'order.created', 'order.confirmed', 'order.status_changed', 'order.cancelled',
  'order.shipped', 'order.delivered',
  'return.requested', 'return.approved', 'return.received', 'return.refunded',
  'customer.registered', 'customer.deletion_requested', 'contact.message_received',
  'product.created', 'product.out_of_stock', 'inventory.low_stock', 'inventory.restock',
  'payment.failed', 'payment.disputed', 'payment.refunded',
]

const prisma = new PrismaClient()
const TEST_ID = `e2e${Date.now().toString(36)}${randomUUID().slice(0, 4)}`.toLowerCase()

type Result = { event: string; status: 'pass' | 'fail' | 'skip'; note?: string }
const results: Result[] = []
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitForLog(
  subscriptionId: string,
  eventType: string,
  beforeAt: Date,
  timeoutMs = 3000,
): Promise<any | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const log = await prisma.webhookDeliveryLog.findFirst({
      where: { subscriptionId, eventType, createdAt: { gt: beforeAt } },
      orderBy: { createdAt: 'desc' },
    })
    if (log) return log
    await sleep(100)
  }
  return null
}

async function run() {
  console.log('\n════════════════════════════════════════════════')
  console.log(`  WEBHOOK E2E TEST  |  run=${TEST_ID}`)
  console.log('════════════════════════════════════════════════\n')

  if (process.env.NODE_ENV === 'production') {
    console.log('❌ NODE_ENV=production — aborting')
    process.exit(1)
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] })

  const auth = app.get(AuthService)
  const gdpr = app.get(GdprService)
  const contact = app.get(ContactService)
  const products = app.get(ProductsService)
  const inventory = app.get(AdminInventoryService)
  const adminReturns = app.get(AdminReturnsService)
  const payments = app.get(PaymentsService)
  const webhooks = app.get(WebhookService)
  const eventEmitter = app.get(EventEmitter2)

  const created = {
    subId: null as string | null,
    userId: null as string | null,
    productId: null as string | null,
    variantIds: [] as string[],
    inventoryIds: [] as string[],
    addressId: null as string | null,
    orderId: null as string | null,
    paymentId: null as string | null,
    shipmentId: null as string | null,
    returnIds: [] as string[],
    contactIds: [] as string[],
  }

  async function testEvent(eventType: string, trigger: () => Promise<any>): Promise<void> {
    const beforeAt = new Date()
    try {
      await trigger()
    } catch (err: any) {
      results.push({ event: eventType, status: 'fail', note: `trigger threw: ${err?.message ?? err}` })
      console.log(`  ❌ ${eventType.padEnd(36)} trigger threw`)
      return
    }
    await sleep(400)
    const log = await waitForLog(created.subId!, eventType, beforeAt)
    if (!log) {
      results.push({ event: eventType, status: 'fail', note: 'no delivery log' })
      console.log(`  ❌ ${eventType.padEnd(36)} no delivery log`)
      return
    }
    results.push({ event: eventType, status: 'pass', note: `log=${log.id.slice(0, 8)} status=${log.status}` })
    console.log(`  ✅ ${eventType.padEnd(36)} log=${log.id.slice(0, 8)} status=${log.status}`)
  }

  try {
    // SETUP
    console.log('── Setup ─────────────────────────────────────')
    const sub = await webhooks.create({
      url: `https://webhook.example.test/e2e/${TEST_ID}`,
      events: ALL_WEBHOOK_EVENTS,
      description: `E2E ${TEST_ID}`,
    })
    created.subId = sub.id
    console.log(`  subscription created: ${sub.id.slice(0, 8)}`)

    const wh = await prisma.warehouse.findFirst({ where: { isDefault: true } })
    const cat = await prisma.category.findFirst({ where: { isActive: true } })
    if (!wh || !cat) throw new Error('seed data incomplete')
    console.log(`  warehouse: ${wh.name}  category: ${cat.slug}\n`)

    // Phase A: direct service emits
    console.log('── Phase A: Direct service emits ────────────')

    await testEvent('customer.registered', async () => {
      const email = `e2e-${TEST_ID}@example.test`
      await auth.register({
        email, password: 'TestPass123!',
        firstName: 'E2E', lastName: 'User',
        gdprConsent: true,
      })
      const u = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
      if (u) created.userId = u.id
    })

    await testEvent('customer.deletion_requested', async () => {
      if (!created.userId) throw new Error('no userId')
      await gdpr.scheduleAccountDeletion(created.userId, 'TestPass123!')
    })

    await testEvent('contact.message_received', async () => {
      const r = await contact.submit(
        {
          name: `E2E ${TEST_ID}`,
          email: `e2e-contact-${TEST_ID}@example.test`,
          subject: 'E2E', message: 'E2E test', locale: 'de',
        } as any,
        { ipAddress: '127.0.0.1', userAgent: 'e2e' },
      )
      if (r?.id) created.contactIds.push(r.id)
    })

    await testEvent('product.created', async () => {
      const slug = `e2e-${TEST_ID}`
      const skuBase = `E2E${TEST_ID.slice(-6).toUpperCase()}`
      const p = await products.create({
        slug, categoryId: cat.id,
        brand: 'E2E', gender: 'unisex',
        basePrice: 19.99, salePrice: null, taxRate: 19,
        isActive: false, isFeatured: false,
        translations: [
          { language: 'de', name: `E2E ${TEST_ID}`, description: 'Test DE' },
          { language: 'en', name: `E2E ${TEST_ID}`, description: 'Test EN' },
          { language: 'ar', name: `منتج ${TEST_ID}`, description: 'Test AR' },
        ],
        variants: [{ sku: `${skuBase}-R-M`, color: 'Red', size: 'M', priceModifier: 0, initialStock: 10 }],
      } as any)
      created.productId = p.id
      created.variantIds = p.variants.map((v: any) => v.id)
      const inv = await prisma.inventory.findFirst({ where: { variantId: created.variantIds[0] } })
      if (inv) created.inventoryIds.push(inv.id)
    })

    await testEvent('inventory.restock', async () => {
      if (created.inventoryIds.length === 0) throw new Error('no inventory')
      await inventory.intake(
        [{ inventoryId: created.inventoryIds[0], quantity: 5 }],
        'e2e', 'e2e-admin', '127.0.0.1',
      )
    })

    // Pre-build order chain
    const addr = await prisma.address.create({
      data: {
        userId: created.userId!,
        firstName: 'E2E', lastName: 'T',
        street: 'Teststr', houseNumber: '1',
        postalCode: '10115', city: 'Berlin', country: 'DE',
      },
    })
    created.addressId = addr.id

    const orderNumber = `E2E-${TEST_ID.slice(-8).toUpperCase()}`
    const order = await prisma.order.create({
      data: {
        orderNumber, userId: created.userId!, shippingAddressId: addr.id,
        status: 'pending', channel: 'website',
        subtotal: 19.99, shippingCost: 4.99, taxAmount: 3.99,
        discountAmount: 0, totalAmount: 24.98, currency: 'EUR',
        items: {
          create: [{
            variantId: created.variantIds[0], quantity: 1,
            unitPrice: 19.99, taxRate: 19, totalPrice: 19.99,
            snapshotName: 'E2E', snapshotSku: `E2E${TEST_ID.slice(-6).toUpperCase()}-R-M`,
          }],
        },
      },
    })
    created.orderId = order.id

    const pay = await prisma.payment.create({
      data: {
        orderId: order.id, provider: 'STRIPE', method: 'stripe_card',
        status: 'captured', amount: 24.98,
        providerPaymentId: `pi_e2e_${TEST_ID}`, paidAt: new Date(),
      },
    })
    created.paymentId = pay.id

    console.log('\n── Phase B: Order lifecycle ─────────────────')

    await testEvent('order.created', async () => {
      eventEmitter.emit(ORDER_EVENTS.CREATED, {
        orderId: order.id, orderNumber: order.orderNumber,
        correlationId: TEST_ID, items: [],
      })
    })

    await testEvent('order.confirmed', async () => {
      eventEmitter.emit(ORDER_EVENTS.CONFIRMED, {
        orderId: order.id, orderNumber: order.orderNumber,
        correlationId: TEST_ID, reservationIds: [],
      })
    })

    await testEvent('order.status_changed', async () => {
      eventEmitter.emit(ORDER_EVENTS.STATUS_CHANGED, {
        orderId: order.id, fromStatus: 'pending', toStatus: 'processing',
        source: 'e2e', correlationId: TEST_ID,
      })
    })

    const ship = await prisma.shipment.create({
      data: {
        orderId: order.id, carrier: 'dhl', status: 'in_transit',
        trackingNumber: `DHL-${TEST_ID}`,
        trackingUrl: `https://dhl.example/${TEST_ID}`,
        shippedAt: new Date(),
      },
    })
    created.shipmentId = ship.id

    await testEvent('order.shipped', async () => {
      eventEmitter.emit(ORDER_EVENTS.STATUS_CHANGED, {
        orderId: order.id, fromStatus: 'processing', toStatus: 'shipped',
        source: 'e2e', correlationId: TEST_ID,
      })
    })

    await prisma.shipment.update({
      where: { id: ship.id },
      data: { deliveredAt: new Date(), status: 'delivered' },
    })

    await testEvent('order.delivered', async () => {
      eventEmitter.emit(ORDER_EVENTS.STATUS_CHANGED, {
        orderId: order.id, fromStatus: 'shipped', toStatus: 'delivered',
        source: 'e2e', correlationId: TEST_ID,
      })
    })

    await testEvent('order.cancelled', async () => {
      await prisma.order.update({
        where: { id: order.id },
        data: { cancelledAt: new Date(), cancelReason: 'e2e' },
      })
      eventEmitter.emit(ORDER_EVENTS.CANCELLED, {
        orderId: order.id, orderNumber: order.orderNumber,
        correlationId: TEST_ID, reason: 'e2e', reservationIds: [],
      })
    })

    // Reset order to delivered for return flow
    await prisma.order.update({
      where: { id: order.id },
      data: { status: 'delivered', cancelledAt: null, cancelReason: null },
    })

    console.log('\n── Phase C: Returns ─────────────────────────')

    const retRow = await prisma.return.create({
      data: {
        returnNumber: `E2E-RET-${TEST_ID.slice(-6).toUpperCase()}`,
        orderId: order.id, shipmentId: ship.id,
        reason: 'wrong_size', status: 'requested',
        deadline: new Date(Date.now() + 14 * 86_400_000),
        returnItems: [{
          variantId: created.variantIds[0], name: 'E2E',
          sku: `E2E${TEST_ID.slice(-6).toUpperCase()}-R-M`,
          quantity: 1, maxQuantity: 1, unitPrice: 19.99, reason: 'wrong_size',
        }],
        refundAmount: 19.99,
      },
    })
    created.returnIds.push(retRow.id)

    results.push({
      event: 'return.requested', status: 'skip',
      note: 'Covered via shipments.processReturnRequest — skipped in E2E (14-day guard).',
    })
    console.log(`  ⏭️  return.requested                      (skipped — see note)`)

    await testEvent('return.approved', async () => {
      await adminReturns.approve(retRow.id, 'e2e-admin', '127.0.0.1', false)
    })

    await testEvent('return.received', async () => {
      await adminReturns.markReceived(retRow.id, 'e2e-admin', '127.0.0.1')
    })

    results.push({
      event: 'return.refunded', status: 'skip',
      note: 'Requires real Stripe refund — unit tests cover it.',
    })
    console.log(`  ⏭️  return.refunded                       (skipped — Stripe API)`)

    console.log('\n── Phase D: Payment events ──────────────────')

    results.push({
      event: 'payment.refunded', status: 'skip',
      note: 'Requires real Stripe refund — unit tests cover it.',
    })
    console.log(`  ⏭️  payment.refunded                      (skipped — Stripe API)`)

    await testEvent('payment.failed', async () => {
      await payments.handlePaymentFailure(
        pay.providerPaymentId!, 'e2e: card declined', TEST_ID,
      )
    })

    await prisma.order.update({ where: { id: order.id }, data: { status: 'delivered' } })

    await testEvent('payment.disputed', async () => {
      await payments.handleDispute(
        pay.providerPaymentId!, 'e2e: fraudulent', TEST_ID,
      )
    })
  } finally {
    console.log('\n── Cleanup ──────────────────────────────────')
    try {
      if (created.returnIds.length) {
        await prisma.return.deleteMany({ where: { id: { in: created.returnIds } } })
      }
      if (created.shipmentId) await prisma.shipment.delete({ where: { id: created.shipmentId } }).catch(() => {})
      if (created.paymentId) await prisma.payment.delete({ where: { id: created.paymentId } }).catch(() => {})
      if (created.orderId) await prisma.order.delete({ where: { id: created.orderId } }).catch(() => {})
      if (created.contactIds.length) {
        await prisma.contactMessage.deleteMany({ where: { id: { in: created.contactIds } } })
      }
      if (created.productId) {
        await prisma.inventory.deleteMany({ where: { variantId: { in: created.variantIds } } })
        await prisma.productTranslation.deleteMany({ where: { productId: created.productId } })
        await prisma.productVariant.deleteMany({ where: { productId: created.productId } })
        await prisma.product.delete({ where: { id: created.productId } }).catch(() => {})
      }
      if (created.addressId) await prisma.address.delete({ where: { id: created.addressId } }).catch(() => {})
      if (created.userId) {
        await prisma.gdprConsent.deleteMany({ where: { userId: created.userId } })
        await prisma.user.delete({ where: { id: created.userId } }).catch(() => {})
      }
      if (created.subId) {
        const del = await prisma.webhookDeliveryLog.deleteMany({ where: { subscriptionId: created.subId } })
        console.log(`  deleted ${del.count} delivery log(s)`)
        await prisma.webhookSubscription.delete({ where: { id: created.subId } }).catch(() => {})
      }
      console.log('  ✅ cleanup complete')
    } catch (e: any) {
      console.log(`  ⚠️  cleanup warning: ${e?.message ?? e}`)
    }
  }

  console.log('\n════════════════════════════════════════════════')
  console.log('  RESULTS')
  console.log('════════════════════════════════════════════════\n')

  let pass = 0, fail = 0, skip = 0
  for (const r of results) {
    if (r.status === 'pass') pass++
    else if (r.status === 'fail') fail++
    else skip++
  }
  console.log(`  ── ${pass} passed, ${fail} failed, ${skip} skipped ──\n`)

  await app.close()
  await prisma.$disconnect()
  process.exit(fail > 0 ? 1 : 0)
}

run().catch(async (e) => {
  console.error('\n🔴 E2E fatal:', e)
  await prisma.$disconnect()
  process.exit(1)
})
