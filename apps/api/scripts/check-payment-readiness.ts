/**
 * Pre-flight check before the 5-method regression test.
 * Verifies: enabled toggles, recent orders, DB health, no stuck payments.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  PAYMENT REGRESSION TEST — READINESS CHECK')
  console.log('═══════════════════════════════════════════════════════════\n')

  // 1. Which payment methods are enabled in ShopSettings?
  console.log('── 1. Enabled payment methods (ShopSettings) ──')
  const settings = await prisma.shopSetting.findMany({
    where: {
      key: {
        in: ['stripeEnabled', 'klarnaEnabled', 'paypalEnabled', 'sumup_enabled', 'vorkasse_enabled'],
      },
    },
  })
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]))
  const toggles = {
    Stripe: map.stripeEnabled !== 'false',
    PayPal: map.paypalEnabled !== 'false',
    Klarna: map.klarnaEnabled !== 'false',
    SumUp: map.sumup_enabled !== 'false',
    Vorkasse: map.vorkasse_enabled !== 'false',
  }
  for (const [name, enabled] of Object.entries(toggles)) {
    console.log(`   ${enabled ? '✅' : '❌'} ${name}  ${enabled ? '(testable)' : '(disabled — skip this one)'}`)
  }

  // 2. DB env check: required keys present?
  console.log('\n── 2. Provider credentials in .env ──')
  const envs = {
    STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
    PAYPAL_CLIENT_ID: !!process.env.PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET: !!process.env.PAYPAL_CLIENT_SECRET,
    KLARNA_API_KEY: !!process.env.KLARNA_API_KEY,
    SUMUP_API_KEY: !!process.env.SUMUP_API_KEY,
  }
  for (const [key, set] of Object.entries(envs)) {
    console.log(`   ${set ? '✅' : '⚠️ '} ${key}  ${set ? '' : '(not set — will fail)'}`)
  }

  // 3. Any stuck pending orders from previous tests?
  console.log('\n── 3. Currently stuck pending orders ──')
  const stuck = await prisma.order.findMany({
    where: {
      status: { in: ['pending', 'pending_payment'] as any },
      deletedAt: null,
    },
    select: { orderNumber: true, status: true, createdAt: true, totalAmount: true },
    orderBy: { createdAt: 'desc' },
  })
  if (stuck.length === 0) {
    console.log('   ✅ 0 stuck orders — clean state for testing')
  } else {
    console.log(`   ⚠️  ${stuck.length} pending order(s) — cron will clean them up within 10 min:`)
    stuck.slice(0, 5).forEach((o) => {
      const ageMin = Math.floor((Date.now() - o.createdAt.getTime()) / 60000)
      console.log(`      ${o.orderNumber}  €${o.totalAmount}  (${ageMin} min old)  status=${o.status}`)
    })
  }

  // 4. Orders from the last hour grouped by payment method
  console.log('\n── 4. Recent orders last hour (baseline for regression) ──')
  const recent = await prisma.order.findMany({
    where: { createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }, deletedAt: null },
    include: { payment: { select: { provider: true, method: true, status: true } } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })
  if (recent.length === 0) {
    console.log('   (no orders in the last hour)')
  } else {
    recent.forEach((o) => {
      const prov = o.payment?.provider ?? '—'
      const pst = o.payment?.status ?? '—'
      console.log(`   ${o.orderNumber}  €${o.totalAmount}  ${o.status}  payment=${prov}/${pst}`)
    })
  }

  // 5. API health ping via Prisma
  console.log('\n── 5. DB connection ──')
  const count = await prisma.order.count()
  console.log(`   ✅ Connected — ${count} total orders in DB`)

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('  READY FOR REGRESSION TEST')
  console.log('═══════════════════════════════════════════════════════════')
}

main()
  .catch((e) => {
    console.error('ERROR:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
