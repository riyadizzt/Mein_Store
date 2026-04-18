/**
 * E2E against Live Supabase — NON-DESTRUCTIVE (seeds + flips + cleans up).
 *
 * Proves that the "markRefundTransferred" flow actually fixes the finance-
 * report visibility gap for Vorkasse refunds:
 *
 *   1. Seed: User + Order + Payment(VORKASSE) + Refund(PENDING)
 *   2. Verify aggregateRefunds() does NOT count the pending refund
 *   3. Call markRefundTransferred()
 *   4. Verify aggregateRefunds() DOES count the now-PROCESSED refund
 *   5. Tear everything down
 *
 * Uses compiled dist imports to preserve Nest decorator metadata (the same
 * pattern as test-webhook-live.ts). Runs a standalone Nest app context so
 * DI + Prisma wiring match production exactly.
 */

// Load .env
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config()
} catch {}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NestFactory } = require('@nestjs/core')
const distBase = '../dist/apps/api/src'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require(`${distBase}/app.module`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaService } = require(`${distBase}/prisma/prisma.service`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AdminReturnsService } = require(`${distBase}/modules/admin/services/admin-returns.service`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { FinanceReportsService } = require(`${distBase}/modules/admin/services/finance-reports.service`)

const TEST_ADMIN_ID = 'e2e-test-admin-' + Date.now()

async function main() {
  const cleanup = {
    userId: '',
    orderId: '',
    paymentId: '',
    refundId: '',
    auditId: null as string | null,
  }

  const pass: string[] = []
  const fail: string[] = []

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] })
  const prisma = app.get(PrismaService)
  const returns = app.get(AdminReturnsService)
  const finance = app.get(FinanceReportsService)

  try {
    console.log('\n═══ Seeding test fixtures ═══')

    const user = await prisma.user.create({
      data: {
        email: `e2e-vorkasse-${Date.now()}@test.invalid`,
        passwordHash: null,
        firstName: 'E2E',
        lastName: 'Vorkasse',
        role: 'customer',
        isVerified: false,
      },
    })
    cleanup.userId = user.id
    console.log(`  ✓ user:    ${user.id}`)

    const variant = await prisma.productVariant.findFirst({
      where: { isActive: true, inventory: { some: { quantityOnHand: { gt: 0 } } } },
      include: { inventory: { take: 1 } },
    })
    if (!variant || variant.inventory.length === 0) throw new Error('no seed variant available')
    const warehouseId = variant.inventory[0].warehouseId

    const order = await prisma.order.create({
      data: {
        orderNumber: `E2E-VK-${Date.now()}`,
        userId: user.id,
        status: 'refunded',
        channel: 'website',
        subtotal: 42.5,
        shippingCost: 0,
        discountAmount: 0,
        taxAmount: 6.79,
        totalAmount: 42.5,
        currency: 'EUR',
        notes: 'E2E_TEST_DO_NOT_USE',
        items: {
          create: {
            variantId: variant.id,
            quantity: 1,
            unitPrice: 42.5,
            taxRate: 19,
            totalPrice: 42.5,
            snapshotName: 'E2E Test Item',
            snapshotSku: variant.sku,
          },
        },
      },
    })
    cleanup.orderId = order.id
    console.log(`  ✓ order:   ${order.id} (${order.orderNumber})`)

    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'VORKASSE',
        method: 'vorkasse',
        providerPaymentId: `E2E-VK-${Date.now()}`,
        amount: 42.5,
        currency: 'EUR',
        status: 'refunded',
        refundedAmount: 42.5,
      },
    })
    cleanup.paymentId = payment.id
    console.log(`  ✓ payment: ${payment.id} (VORKASSE)`)

    const refund = await prisma.refund.create({
      data: {
        paymentId: payment.id,
        amount: 42.5,
        reason: 'E2E test',
        status: 'PENDING',
        providerRefundId: `E2E-VK-REFUND-${Date.now()}`,
        idempotencyKey: `e2e-vk-${Date.now()}`,
        processedAt: null,
        createdBy: TEST_ADMIN_ID,
      },
    })
    cleanup.refundId = refund.id
    console.log(`  ✓ refund:  ${refund.id} (status=PENDING)`)

    const agg = (start: Date, end: Date) =>
      (finance as any).aggregateRefunds(start, end) as Promise<{ totalRefunded: number; refundCount: number }>

    const today = new Date()
    const start = new Date(today)
    start.setUTCHours(0, 0, 0, 0)
    const end = new Date(today)
    end.setUTCHours(23, 59, 59, 999)

    console.log('\n═══ Pre-flip: refund must be INVISIBLE in reports ═══')
    const beforeAgg = await agg(start, end)
    const beforeStatus = (await prisma.refund.findUnique({ where: { id: refund.id } }))?.status
    if (beforeStatus === 'PENDING') {
      pass.push('pre-flip: refund status=PENDING in DB')
    } else {
      fail.push(`pre-flip: expected PENDING, got ${beforeStatus}`)
    }
    console.log(`  Refund status before flip: ${beforeStatus}`)
    console.log(`  aggregateRefunds today (all PROCESSED refunds): €${beforeAgg.totalRefunded.toFixed(2)} / ${beforeAgg.refundCount} rows`)

    console.log('\n═══ Flip: markRefundTransferred ═══')
    const flipped = await returns.markRefundTransferred(refund.id, TEST_ADMIN_ID, '127.0.0.1')
    if (flipped.status === 'PROCESSED') pass.push('flip: returned object status=PROCESSED')
    else fail.push(`flip: expected PROCESSED, got ${flipped.status}`)
    if (flipped.processedAt instanceof Date) pass.push('flip: processedAt is a Date')
    else fail.push(`flip: processedAt not a Date (${typeof flipped.processedAt})`)

    const fresh = await prisma.refund.findUnique({ where: { id: refund.id } })
    if (fresh?.status === 'PROCESSED' && fresh.processedAt) {
      pass.push('flip: DB row updated (status + processedAt)')
    } else {
      fail.push(`flip: DB row mismatch — status=${fresh?.status} processedAt=${fresh?.processedAt}`)
    }

    console.log('\n═══ Post-flip: refund must be VISIBLE in reports ═══')
    const afterAgg = await agg(start, end)
    const delta = afterAgg.totalRefunded - beforeAgg.totalRefunded
    if (Math.abs(delta - 42.5) < 0.01) {
      pass.push(`post-flip: aggregate delta=€${delta.toFixed(2)} (our €42.50 refund is counted)`)
    } else {
      fail.push(`post-flip: aggregate delta=€${delta.toFixed(2)} — expected ~€42.50`)
    }
    if (afterAgg.refundCount - beforeAgg.refundCount === 1) {
      pass.push('post-flip: refundCount +1')
    } else {
      fail.push(`post-flip: refundCount delta=${afterAgg.refundCount - beforeAgg.refundCount} — expected 1`)
    }

    console.log('\n═══ Idempotency: second call must reject ═══')
    try {
      await returns.markRefundTransferred(refund.id, TEST_ADMIN_ID, '127.0.0.1')
      fail.push('idempotency: second call did NOT throw')
    } catch (e: any) {
      if (e?.response?.error === 'RefundNotPending') {
        pass.push('idempotency: second call → RefundNotPending')
      } else {
        fail.push(`idempotency: wrong error: ${JSON.stringify(e?.response ?? e?.message)}`)
      }
    }

    console.log('\n═══ Audit trail ═══')
    const auditRow = await prisma.adminAuditLog.findFirst({
      where: { action: 'VORKASSE_REFUND_CONFIRMED', entityId: refund.id },
      orderBy: { createdAt: 'desc' },
    })
    if (auditRow) {
      cleanup.auditId = auditRow.id
      pass.push(`audit: VORKASSE_REFUND_CONFIRMED row written (admin=${auditRow.adminId})`)
    } else {
      fail.push('audit: no VORKASSE_REFUND_CONFIRMED row written')
    }
  } catch (e: any) {
    fail.push(`FATAL: ${e.message}`)
    console.error(e)
  } finally {
    console.log('\n═══ Cleanup ═══')
    try {
      if (cleanup.auditId) {
        await prisma.adminAuditLog.delete({ where: { id: cleanup.auditId } }).catch(() => {})
      }
      if (cleanup.refundId) {
        await prisma.refund.delete({ where: { id: cleanup.refundId } }).catch(() => {})
      }
      if (cleanup.paymentId) {
        await prisma.payment.delete({ where: { id: cleanup.paymentId } }).catch(() => {})
      }
      if (cleanup.orderId) {
        await prisma.orderItem.deleteMany({ where: { orderId: cleanup.orderId } }).catch(() => {})
        await prisma.order.delete({ where: { id: cleanup.orderId } }).catch(() => {})
      }
      if (cleanup.userId) {
        await prisma.user.delete({ where: { id: cleanup.userId } }).catch(() => {})
      }
      console.log('  ✓ cleaned')
    } catch (e: any) {
      console.warn(`  ⚠ cleanup warning: ${e.message}`)
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
