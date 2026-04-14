/**
 * Manual recovery helper for the 14.04.2026 Vorkasse-email gap.
 *
 * Usage:
 *   pnpm --filter @omnichannel/api exec ts-node scripts/resend-vorkasse-for-order.ts ORD-20260414-000032
 *
 * OR (shorter, inside apps/api):
 *   npx ts-node scripts/resend-vorkasse-for-order.ts ORD-20260414-000032
 *
 * Looks up an order by its order number, verifies it's a Vorkasse order
 * in a still-payable state, then calls PaymentsService.sendVorkasseInstructions()
 * directly — bypassing the HTTP layer and the admin JWT requirement.
 *
 * This is for customers who ordered Vorkasse BEFORE the instructions
 * email feature was deployed (so `createPayment` didn't trigger the
 * email automatically). It's a one-off remediation tool, not a cron.
 *
 * Non-destructive: only queues an email, never modifies the order.
 * The email goes through the normal BullMQ queue so it'll respect
 * rate limits and retries.
 */

import { NestFactory } from '@nestjs/core'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { PaymentsService } from '../src/modules/payments/payments.service'

async function main() {
  const orderNumber = process.argv[2]
  if (!orderNumber) {
    console.error('Usage: ts-node scripts/resend-vorkasse-for-order.ts <orderNumber>')
    console.error('Example: ts-node scripts/resend-vorkasse-for-order.ts ORD-20260414-000032')
    process.exit(1)
  }

  console.log('═══════════════════════════════════════════════════════════')
  console.log(`  VORKASSE RESEND — ${orderNumber}`)
  console.log('═══════════════════════════════════════════════════════════\n')

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  })
  const prisma = app.get(PrismaService)
  const paymentsService = app.get(PaymentsService)

  try {
    // ── 1. Find the order by its human-readable number ──
    const order = await prisma.order.findUnique({
      where: { orderNumber },
      include: {
        payment: { select: { provider: true, status: true } },
        user: { select: { email: true, firstName: true, preferredLang: true } },
      },
    })

    if (!order) {
      console.error(`❌ Order ${orderNumber} not found`)
      process.exit(1)
    }

    console.log(`✅ Found order`)
    console.log(`   id:           ${order.id}`)
    console.log(`   status:       ${order.status}`)
    console.log(`   totalAmount:  €${order.totalAmount}`)
    console.log(`   createdAt:    ${order.createdAt.toISOString()}`)
    console.log(`   payment:      ${order.payment?.provider ?? 'NONE'} / ${order.payment?.status ?? '—'}`)
    console.log(`   recipient:    ${order.user?.email ?? order.guestEmail ?? '(none)'}`)

    // ── 2. Guard: only Vorkasse orders ──
    if (!order.payment || order.payment.provider !== 'VORKASSE') {
      console.error(`\n❌ Order ${orderNumber} is not a Vorkasse order (provider=${order.payment?.provider ?? 'none'})`)
      console.error('   Aborting — this script only handles bank-transfer orders.')
      process.exit(1)
    }

    // ── 3. Guard: only pending orders (already-captured don't need it) ──
    if (order.payment.status === 'captured') {
      console.error(`\n⚠ Payment already captured for ${orderNumber} — customer has paid, no need to resend.`)
      console.error('   Aborting — this would be spam.')
      process.exit(1)
    }
    if (['cancelled', 'refunded'].includes(order.status)) {
      console.error(`\n⚠ Order ${orderNumber} is ${order.status} — customer does not need payment instructions anymore.`)
      console.error('   Aborting — this would be confusing.')
      process.exit(1)
    }

    // ── 4. Dispatch the email ──
    console.log(`\n── Queueing email ──`)
    await paymentsService.sendVorkasseInstructions(order.id, `manual-resend-${Date.now()}`)
    console.log(`✅ Email queued for ${order.user?.email ?? order.guestEmail}`)
    console.log(`   Template:     vorkasse-instructions`)
    console.log(`   Language:     ${order.user?.preferredLang ?? 'from order.notes.locale'}`)
    console.log(`   Subject:      Zahlungsinformationen — Bestellung ${order.orderNumber}`)
    console.log(`\n💡 Check the admin audit log (if you care about tracking this manual resend):`)
    console.log(`   Or grep the worker logs for "${order.orderNumber}"`)
  } catch (err) {
    console.error('\n❌ Error:', (err as Error).message)
    if ((err as any).stack) console.error((err as any).stack)
    process.exit(1)
  } finally {
    await app.close()
  }
}

main().catch((e) => {
  console.error('fatal:', e)
  process.exit(1)
})
