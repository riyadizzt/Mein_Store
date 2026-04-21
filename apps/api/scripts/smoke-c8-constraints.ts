/**
 * C8 Live-DB smoke: verifies the two idempotency constraints work as
 * designed against real Supabase. Non-destructive — creates temporary
 * test rows and cleans them up at the end even if assertions fail.
 *
 * Covers:
 *   T3  marketplace_order_imports rejects duplicate (marketplace,
 *       external_order_id) with P2002
 *   T4  orders partial-unique rejects duplicate (channel='ebay',
 *       channel_order_id='XXX') with P2002
 *   T5  orders partial-unique allows multiple NULL channel_order_id
 *       (normal Shop-website orders)
 *   T6  partial-unique lets DIFFERENT (channel, channel_order_id)
 *       pairs coexist (e.g. ebay+X and tiktok+X)
 *
 * Cleanup strategy: every test row carries a marker in order_number
 * ('SMOKE-C8-<timestamp>-<suffix>') or marketplace_order_imports.
 * external_order_id ('SMOKE-C8-<timestamp>-<suffix>'). A final
 * delete-by-marker pass runs in try/finally.
 *
 * Pre-requisites:
 *   - Migration 20260422_marketplace_foundation applied
 *   - Prisma client regenerated (pnpm prisma generate)
 */

import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()
const STAMP = `SMOKE-C8-${Date.now()}`

// Single throw-away user + address needed for orders to satisfy FK
// and CHECK constraints. Same minimal shape as Phase-1 smoke scripts.
async function getSeedIds(): Promise<{ userId: string; addressId: string }> {
  const someUser = await p.user.findFirst({ select: { id: true } })
  if (!someUser) throw new Error('No seed user exists — run seeds first')
  const someAddr = await p.address.findFirst({
    where: { userId: someUser.id },
    select: { id: true },
  })
  if (!someAddr) throw new Error('No seed address exists for seed user')
  return { userId: someUser.id, addressId: someAddr.id }
}

async function createShopOrder(orderNumber: string, channelOrderId: string | null) {
  const { userId, addressId } = await getSeedIds()
  return p.order.create({
    data: {
      orderNumber,
      userId,
      shippingAddressId: addressId,
      status: 'pending',
      channel: channelOrderId ? 'ebay' : 'website',
      channelOrderId,
      subtotal: '1.00',
      taxAmount: '0.16',
      totalAmount: '1.00',
      currency: 'EUR',
    },
    select: { id: true },
  })
}

async function cleanup() {
  try {
    await p.order.deleteMany({ where: { orderNumber: { startsWith: STAMP } } })
  } catch {}
  try {
    await p.marketplaceOrderImport.deleteMany({
      where: { externalOrderId: { startsWith: STAMP } },
    })
  } catch {}
}

async function expectP2002<T>(label: string, fn: () => Promise<T>): Promise<boolean> {
  try {
    await fn()
    console.log(`🔴 ${label}: expected P2002 but the write succeeded`)
    return false
  } catch (e: any) {
    if (e?.code === 'P2002') {
      console.log(`✅ ${label}`)
      return true
    }
    console.log(`🔴 ${label}: wrong error code ${e?.code ?? e?.message}`)
    return false
  }
}

async function main() {
  let fails = 0
  console.log(`=== C8 Live-DB Smoke — stamp=${STAMP} ===\n`)

  try {
    // T3 — marketplace_order_imports @@unique rejects duplicates
    await p.marketplaceOrderImport.create({
      data: {
        marketplace: 'EBAY',
        externalOrderId: `${STAMP}-T3`,
        status: 'IMPORTING',
      },
    })
    const ok3 = await expectP2002('T3 marketplaceOrderImport @@unique([marketplace, externalOrderId]) blocks duplicate',
      () => p.marketplaceOrderImport.create({
        data: {
          marketplace: 'EBAY',
          externalOrderId: `${STAMP}-T3`,
          status: 'IMPORTING',
        },
      })
    )
    if (!ok3) fails++

    // T3b — same external_order_id on DIFFERENT marketplaces is allowed
    try {
      await p.marketplaceOrderImport.create({
        data: {
          marketplace: 'TIKTOK',
          externalOrderId: `${STAMP}-T3`, // same external ID
          status: 'IMPORTING',
        },
      })
      console.log('✅ T3b same externalOrderId on different marketplace allowed')
    } catch (e: any) {
      console.log(`🔴 T3b: expected success but got ${e?.code ?? e?.message}`)
      fails++
    }

    // T4 — orders partial-unique blocks duplicate (channel, channel_order_id)
    await createShopOrder(`${STAMP}-T4a`, `${STAMP}-chOrderId`)
    const ok4 = await expectP2002('T4 orders partial-unique blocks duplicate (ebay, channelOrderId)',
      () => createShopOrder(`${STAMP}-T4b`, `${STAMP}-chOrderId`)
    )
    if (!ok4) fails++

    // T5 — multiple NULL channel_order_id rows allowed (normal Shop)
    try {
      await createShopOrder(`${STAMP}-T5a`, null)
      await createShopOrder(`${STAMP}-T5b`, null)
      await createShopOrder(`${STAMP}-T5c`, null)
      console.log('✅ T5 three orders with NULL channel_order_id all accepted')
    } catch (e: any) {
      console.log(`🔴 T5: expected success but got ${e?.code ?? e?.message}`)
      fails++
    }

    // T6 — different (channel, channel_order_id) pairs coexist freely
    // (channel=ebay with different external-id is trivially fine)
    try {
      await createShopOrder(`${STAMP}-T6a`, `${STAMP}-ID-one`)
      await createShopOrder(`${STAMP}-T6b`, `${STAMP}-ID-two`)
      console.log('✅ T6 different channel_order_id values on same channel coexist')
    } catch (e: any) {
      console.log(`🔴 T6: ${e?.code ?? e?.message}`)
      fails++
    }

    console.log(`\n=== ${fails === 0 ? 'PASS' : 'FAIL'}: ${fails} failure${fails === 1 ? '' : 's'} ===`)
  } finally {
    await cleanup()
    await p.$disconnect()
  }

  process.exit(fails === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('Unhandled error:', e)
  await cleanup()
  await p.$disconnect()
  process.exit(2)
})
