/**
 * E2E against Live Supabase — NON-DESTRUCTIVE.
 *
 * Proves the admin read-tracking flow end-to-end:
 *   1. Count unread orders (baseline).
 *   2. Seed one new order in status 'pending' → baseline +1.
 *   3. Call AdminOrdersService.findOne(id, adminId) → should mark as viewed.
 *   4. Count again → baseline (seed is now "read").
 *   5. Verify DB row has correct firstViewedByAdminAt + firstViewedByAdmin.
 *   6. Clean up the seed order.
 */

try {
  const fs = require('node:fs')
  const path = require('node:path')
  const envText = fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8')
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(m[1] in process.env)) process.env[m[1]] = v
  }
} catch {}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NestFactory } = require('@nestjs/core')
const distBase = '../dist/apps/api/src'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require(`${distBase}/app.module`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaService } = require(`${distBase}/prisma/prisma.service`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AdminOrdersService } = require(`${distBase}/modules/admin/services/admin-orders.service`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DashboardService } = require(`${distBase}/modules/admin/services/dashboard.service`)

const TEST_ADMIN_ID = 'e2e-read-tracking-' + Date.now()

async function main() {
  const cleanup = { orderId: '', userId: '' }
  const pass: string[] = []
  const fail: string[] = []

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] })
  const prisma = app.get(PrismaService)
  const orders = app.get(AdminOrdersService)
  const dashboard = app.get(DashboardService)

  try {
    const countUnread = () =>
      prisma.order.count({
        where: {
          firstViewedByAdminAt: null,
          status: { in: ['pending', 'pending_payment', 'confirmed', 'processing'] },
          deletedAt: null,
        },
      })

    console.log('\n═══ Baseline ═══')
    const baseline = await countUnread()
    console.log(`  Unread orders before seed: ${baseline}`)

    console.log('\n═══ Seed: new pending order ═══')
    const user = await prisma.user.create({
      data: {
        email: `e2e-read-${Date.now()}@test.invalid`,
        passwordHash: null,
        firstName: 'E2E',
        lastName: 'Read',
        role: 'customer',
      },
    })
    cleanup.userId = user.id

    const variant = await prisma.productVariant.findFirst({ where: { isActive: true } })
    if (!variant) throw new Error('no active variant')

    const order = await prisma.order.create({
      data: {
        orderNumber: `E2E-READ-${Date.now()}`,
        userId: user.id,
        status: 'pending',
        channel: 'website',
        subtotal: 10,
        shippingCost: 0,
        discountAmount: 0,
        taxAmount: 1.6,
        totalAmount: 10,
        currency: 'EUR',
        items: {
          create: {
            variantId: variant.id,
            quantity: 1,
            unitPrice: 10,
            taxRate: 19,
            totalPrice: 10,
            snapshotName: 'E2E',
            snapshotSku: variant.sku,
          },
        },
      },
    })
    cleanup.orderId = order.id
    console.log(`  ✓ order ${order.orderNumber} (status=pending, firstViewedByAdminAt=null)`)

    const afterSeed = await countUnread()
    if (afterSeed === baseline + 1) pass.push(`seed: unread +1 (${baseline} → ${afterSeed})`)
    else fail.push(`seed: expected ${baseline + 1}, got ${afterSeed}`)

    console.log('\n═══ findOne with adminId — should auto-mark as viewed ═══')
    await orders.findOne(order.id, TEST_ADMIN_ID)
    // Wait for fire-and-forget update to commit.
    await new Promise((resolve) => setTimeout(resolve, 500))

    const fresh = await prisma.order.findUnique({ where: { id: order.id } })
    if (fresh?.firstViewedByAdminAt instanceof Date) {
      pass.push(`firstViewedByAdminAt set: ${fresh.firstViewedByAdminAt.toISOString()}`)
    } else {
      fail.push(`firstViewedByAdminAt expected Date, got ${typeof fresh?.firstViewedByAdminAt}`)
    }
    if (fresh?.firstViewedByAdmin === TEST_ADMIN_ID) {
      pass.push(`firstViewedByAdmin set to "${TEST_ADMIN_ID}"`)
    } else {
      fail.push(`firstViewedByAdmin expected "${TEST_ADMIN_ID}", got "${fresh?.firstViewedByAdmin}"`)
    }

    console.log('\n═══ Post-flip: unread count should go back to baseline ═══')
    const afterView = await countUnread()
    if (afterView === baseline) pass.push(`post-view: unread back to baseline ${baseline}`)
    else fail.push(`post-view: expected ${baseline}, got ${afterView}`)

    console.log('\n═══ Second findOne — must NOT overwrite firstViewedByAdmin ═══')
    await orders.findOne(order.id, 'some-other-admin')
    await new Promise((resolve) => setTimeout(resolve, 500))
    const fresh2 = await prisma.order.findUnique({ where: { id: order.id } })
    if (fresh2?.firstViewedByAdmin === TEST_ADMIN_ID) {
      pass.push('first-writer-wins: 2nd admin did NOT overwrite firstViewedByAdmin')
    } else {
      fail.push(`first-writer-wins: 2nd admin overwrote ("${fresh2?.firstViewedByAdmin}")`)
    }

    console.log('\n═══ Dashboard openOrdersUnread counter ═══')
    const overview = await dashboard.getOverview()
    if (typeof overview.openOrdersUnread === 'number') {
      pass.push(`dashboard.openOrdersUnread is a number: ${overview.openOrdersUnread}`)
    } else {
      fail.push(`dashboard.openOrdersUnread missing or not a number: ${JSON.stringify(overview.openOrdersUnread)}`)
    }
    if (overview.openOrdersUnread === baseline) {
      pass.push(`dashboard.openOrdersUnread matches raw query (${baseline})`)
    } else {
      fail.push(`dashboard.openOrdersUnread=${overview.openOrdersUnread} != raw baseline=${baseline}`)
    }
  } catch (e: any) {
    fail.push(`FATAL: ${e.message}`)
    console.error(e)
  } finally {
    console.log('\n═══ Cleanup ═══')
    try {
      if (cleanup.orderId) {
        await prisma.orderItem.deleteMany({ where: { orderId: cleanup.orderId } }).catch(() => {})
        await prisma.order.delete({ where: { id: cleanup.orderId } }).catch(() => {})
      }
      if (cleanup.userId) {
        await prisma.user.delete({ where: { id: cleanup.userId } }).catch(() => {})
      }
      console.log('  ✓ cleaned')
    } catch (e: any) {
      console.warn(`  ⚠ cleanup: ${e.message}`)
    }
    await app.close()
  }

  console.log('\n═══ Results ═══')
  for (const p of pass) console.log(`  ✓ ${p}`)
  for (const f of fail) console.log(`  ✗ ${f}`)
  console.log(`\n  ${pass.length} pass / ${fail.length} fail\n`)
  process.exit(fail.length === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('fatal', e)
  process.exit(1)
})
