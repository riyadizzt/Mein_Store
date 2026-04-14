/**
 * E2E test for the public guest return flow.
 *
 * Sets up a complete throwaway scenario in the DB:
 *   - stub user (passwordHash=null)
 *   - delivered order with items
 *   - shipment with deliveredAt
 *   - notes.confirmationToken planted
 *
 * Then hits the live API endpoints and verifies:
 *   1. GET prefill returns item list + canReturn=true
 *   2. POST with valid token creates a Return row
 *   3. Order status flips to 'returned'
 *   4. GET with WRONG token is rejected (401)
 *   5. POST with WRONG token is rejected (401)
 *
 * Cleans up everything at the end.
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
  console.log('  Public Return Flow — E2E test')
  console.log('═══════════════════════════════════════════════════════════\n')

  const unique = Date.now()
  const testEmail = `return-test-${unique}@malak-test.local`
  const token = crypto.randomBytes(16).toString('hex')
  const wrongToken = crypto.randomBytes(16).toString('hex')

  let userId: string | null = null
  let orderId: string | null = null
  let variantId: string | null = null

  try {
    // 1. Reuse an existing variant so we don't need to create product/inventory
    const existingVariant = await prisma.productVariant.findFirst({
      where: { isActive: true },
    })
    if (!existingVariant) {
      fail('setup', 'no product variant in DB to reuse')
      return
    }
    variantId = existingVariant.id

    // 2. Create stub user
    console.log('── 1. Setup — stub user + delivered order ──')
    const user = await prisma.user.create({
      data: {
        email: testEmail,
        passwordHash: null,
        firstName: 'Return',
        lastName: 'Test',
        role: 'customer',
        isVerified: false,
        isActive: true,
      },
    })
    userId = user.id
    pass('stub user created', testEmail)

    // 3. Create an address
    const address = await prisma.address.create({
      data: {
        userId: user.id,
        firstName: 'Return', lastName: 'Test',
        street: 'Pannierstr', houseNumber: '4',
        postalCode: '12047', city: 'Berlin', country: 'DE',
      },
    })

    // 4. Create delivered order with confirmationToken
    const orderNumber = `TEST-RET-${unique}`
    const order: any = await prisma.order.create({
      data: {
        orderNumber,
        userId: user.id,
        status: 'delivered',
        subtotal: 50, shippingCost: 4.99, taxAmount: 8.77, totalAmount: 54.99,
        currency: 'EUR',
        shippingAddressId: address.id,
        channel: 'website' as any,
        notes: JSON.stringify({ confirmationToken: token }),
        items: {
          create: [
            {
              variantId: variantId,
              snapshotName: 'Test Product',
              snapshotSku: 'TEST-SKU-001',
              quantity: 2,
              unitPrice: 25,
              totalPrice: 50,
              taxRate: 19,
            },
          ],
        },
      },
      include: { items: true },
    })
    orderId = order.id
    pass('delivered order created', orderNumber)

    // 5. Create shipment with deliveredAt (2 days ago, inside 14-day window)
    const deliveredAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    await prisma.shipment.create({
      data: {
        orderId: order.id,
        carrier: 'dhl' as any,
        trackingNumber: `TEST-TRACK-${unique}`,
        status: 'delivered' as any,
        deliveredAt,
      },
    })
    pass('shipment with deliveredAt created', `${deliveredAt.toISOString()}`)

    // ── 6. GET public prefill with VALID token ──
    console.log('\n── 2. GET prefill with valid token ──')
    const prefillRes = await fetch(
      `${API}/public/orders/${orderId}/return-info?token=${token}`,
    )
    if (!prefillRes.ok) {
      fail('GET prefill', `status ${prefillRes.status}: ${await prefillRes.text()}`)
      return
    }
    const prefill: any = await prefillRes.json()
    if (prefill.canReturn === true && prefill.items?.length > 0 && prefill.daysLeft > 0) {
      pass('prefill data', `canReturn=true, ${prefill.items.length} items, ${prefill.daysLeft} days left`)
    } else {
      fail('prefill data', `canReturn=${prefill.canReturn}, items=${prefill.items?.length}, daysLeft=${prefill.daysLeft}`)
    }

    // ── 7. GET with WRONG token ──
    console.log('\n── 3. GET prefill with WRONG token ──')
    const wrongGetRes = await fetch(
      `${API}/public/orders/${orderId}/return-info?token=${wrongToken}`,
    )
    if (wrongGetRes.status === 401) {
      pass('wrong token rejected on GET', `status ${wrongGetRes.status}`)
    } else {
      fail('wrong token GET', `expected 401, got ${wrongGetRes.status}`)
    }

    // ── 8. POST return with WRONG token ──
    console.log('\n── 4. POST with WRONG token ──')
    const wrongPostRes = await fetch(
      `${API}/public/orders/${orderId}/return-request?token=${wrongToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: 'changed_mind',
          notes: '',
          items: [{ variantId, quantity: 1, reason: 'changed_mind' }],
        }),
      },
    )
    if (wrongPostRes.status === 401) {
      pass('wrong token rejected on POST', `status ${wrongPostRes.status}`)
    } else {
      fail('wrong token POST', `expected 401, got ${wrongPostRes.status}`)
    }

    // ── 9. POST return with VALID token ──
    console.log('\n── 5. POST with VALID token ──')
    const postRes = await fetch(
      `${API}/public/orders/${orderId}/return-request?token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: 'wrong_size',
          notes: 'Too big',
          items: [{ variantId, quantity: 1, reason: 'wrong_size' }],
        }),
      },
    )
    if (!postRes.ok) {
      fail('POST return', `status ${postRes.status}: ${await postRes.text()}`)
      return
    }
    const postBody: any = await postRes.json()
    if (postBody.returnNumber && postBody.status === 'requested') {
      pass('return request created', `${postBody.returnNumber}, status=${postBody.status}`)
    } else {
      fail('POST return payload', JSON.stringify(postBody))
    }

    // ── 10. DB check — return row exists ──
    console.log('\n── 6. DB verification ──')
    const returnRow = await prisma.return.findFirst({ where: { orderId: orderId! } })
    if (returnRow && returnRow.status === 'requested') {
      pass('return row in DB', `${returnRow.returnNumber}`)
    } else {
      fail('return row', `not found or wrong status: ${returnRow?.status}`)
    }

    // ── 11. Order status flipped to 'returned' ──
    const updatedOrder = await prisma.order.findUnique({ where: { id: orderId! } })
    if (updatedOrder?.status === 'returned') {
      pass('order status → returned', updatedOrder.status)
    } else {
      fail('order status', `expected 'returned', got '${updatedOrder?.status}'`)
    }

  } finally {
    // Cleanup
    console.log('\n── Cleanup ──')
    if (orderId) {
      await prisma.return.deleteMany({ where: { orderId } }).catch(() => {})
      await prisma.shipment.deleteMany({ where: { orderId } }).catch(() => {})
      await prisma.orderItem.deleteMany({ where: { orderId } }).catch(() => {})
      await prisma.orderStatusHistory.deleteMany({ where: { orderId } }).catch(() => {})
      await prisma.order.delete({ where: { id: orderId } }).catch(() => {})
    }
    if (userId) {
      await prisma.address.deleteMany({ where: { userId } }).catch(() => {})
      await prisma.user.delete({ where: { id: userId } }).catch(() => {})
    }
    console.log('  🧹 Test data deleted')
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════')
  const p = results.filter((r) => r.status === 'PASS').length
  const f = results.filter((r) => r.status === 'FAIL').length
  console.log(`  RESULT: ${p} passed, ${f} failed`)
  console.log('═══════════════════════════════════════════════════════════')
  process.exit(f > 0 ? 1 : 0)
}

main()
  .catch((e) => { console.error('ERROR:', e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
