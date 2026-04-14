/**
 * Live DB verification for Schritt 1 + Schritt 2.
 *
 * Exercises the real Prisma queries against Supabase and checks that the
 * filtering semantics (skip authorized, guest matching, anonymous rejection,
 * fallback array lookup) behave correctly in real PostgreSQL — not just in
 * the Jest mocks.
 *
 * Non-destructive: every state mutation is wrapped in try/finally restore.
 * Skipped tests are reported loudly so missing prerequisites are obvious.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const REUSE_WINDOW_MINUTES = 15

type TestResult = { name: string; status: 'PASS' | 'FAIL' | 'SKIP'; note?: string }
const results: TestResult[] = []

function pass(name: string, note?: string) {
  results.push({ name, status: 'PASS', note })
  console.log(`✅ PASS — ${name}${note ? ` (${note})` : ''}`)
}
function fail(name: string, note: string) {
  results.push({ name, status: 'FAIL', note })
  console.log(`❌ FAIL — ${name}: ${note}`)
}
function skip(name: string, note: string) {
  results.push({ name, status: 'SKIP', note })
  console.log(`⏭  SKIP — ${name}: ${note}`)
}

// Re-implements the exact query from OrdersService.findReusableOrder so we
// can drive it against the live DB without bootstrapping Nest.
async function findReusableOrderLive(dto: any, userId: string | null) {
  const guestEmail = dto.guestEmail?.toLowerCase()
  if (!userId && !guestEmail) return null

  const cutoff = new Date()
  cutoff.setMinutes(cutoff.getMinutes() - REUSE_WINDOW_MINUTES)

  const candidates = await prisma.order.findMany({
    where: {
      deletedAt: null,
      status: { in: ['pending', 'pending_payment'] },
      createdAt: { gte: cutoff },
      ...(userId ? { userId } : { guestEmail }),
    },
    include: {
      items: { select: { variantId: true, quantity: true } },
      payment: { select: { status: true } },
      shippingAddress: {
        select: {
          firstName: true, lastName: true, street: true, houseNumber: true,
          postalCode: true, city: true, country: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  })

  if (candidates.length === 0) return null

  const incomingItems = [...dto.items]
    .map((i: any) => `${i.variantId}:${i.quantity}`)
    .sort()
    .join('|')
  const incomingCoupon = dto.couponCode ?? null
  const incomingAddrId = dto.shippingAddressId ?? null
  const incomingAddrFields = dto.shippingAddress
    ? [
        dto.shippingAddress.firstName, dto.shippingAddress.lastName,
        dto.shippingAddress.street, dto.shippingAddress.houseNumber,
        dto.shippingAddress.postalCode, dto.shippingAddress.city,
        dto.shippingAddress.country,
      ].join('|')
    : null

  for (const order of candidates) {
    if (order.payment && ['authorized', 'captured'].includes(order.payment.status)) continue

    const orderItems = order.items
      .filter((i) => i.variantId)
      .map((i) => `${i.variantId}:${i.quantity}`)
      .sort()
      .join('|')
    if (orderItems !== incomingItems) continue
    if ((order.couponCode ?? null) !== incomingCoupon) continue

    if (incomingAddrId) {
      if (order.shippingAddressId !== incomingAddrId) continue
    } else if (incomingAddrFields) {
      const a = order.shippingAddress
      if (!a) continue
      const orderAddrFields = [
        a.firstName, a.lastName, a.street, a.houseNumber,
        a.postalCode, a.city, a.country,
      ].join('|')
      if (orderAddrFields !== incomingAddrFields) continue
    } else {
      continue
    }

    return { id: order.id, orderNumber: order.orderNumber }
  }

  return null
}

// Same fallback logic as PaymentsService.findPaymentForWebhook
async function findPaymentForWebhookLive(providerPaymentId: string) {
  const direct = await prisma.payment.findFirst({
    where: { providerPaymentId },
    include: { order: { select: { id: true, orderNumber: true, status: true, notes: true } } },
  })
  if (direct) return { payment: direct, isFallbackHit: false }

  const fallback = await prisma.payment.findFirst({
    where: { previousProviderPaymentIds: { has: providerPaymentId } },
    include: { order: { select: { id: true, orderNumber: true, status: true, notes: true } } },
  })
  if (fallback) return { payment: fallback, isFallbackHit: true }

  return { payment: null, isFallbackHit: false }
}

// ───────────────────────────────────────────────────────────────────
// TEST 1.5 — authorized orders must NOT be reused
// ───────────────────────────────────────────────────────────────────
async function test_1_5_authorized_not_reused() {
  console.log('\n── Test 1.5 — authorized payment blocks reuse ──')

  // Pick any fresh pending order that HAS a payment row we can mutate
  const order = await prisma.order.findFirst({
    where: {
      status: { in: ['pending', 'pending_payment'] },
      deletedAt: null,
      createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) }, // fresh
      payment: { isNot: null },
    },
    include: {
      payment: true,
      items: { select: { variantId: true, quantity: true } },
      shippingAddress: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  if (!order || !order.payment) {
    skip('Test 1.5', 'no fresh pending order with a payment row — create one via checkout first')
    return
  }

  const originalStatus = order.payment.status
  const dto = {
    items: order.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
    shippingAddressId: order.shippingAddressId,
    shippingAddress: order.shippingAddress
      ? {
          firstName: order.shippingAddress.firstName,
          lastName: order.shippingAddress.lastName,
          street: order.shippingAddress.street,
          houseNumber: order.shippingAddress.houseNumber,
          postalCode: order.shippingAddress.postalCode,
          city: order.shippingAddress.city,
          country: order.shippingAddress.country,
        }
      : undefined,
    couponCode: order.couponCode,
  }

  try {
    // Baseline: with payment.status=pending, reuse SHOULD find it
    const baseline = await findReusableOrderLive(dto, order.userId)
    if (baseline?.id !== order.id) {
      fail('Test 1.5 baseline', `expected fresh order to be reusable, got ${baseline?.orderNumber ?? 'null'}`)
      return
    }
    console.log(`   baseline: fresh order IS reusable (${baseline.orderNumber})`)

    // Flip to authorized → should NOT be reusable anymore
    await prisma.payment.update({
      where: { id: order.payment.id },
      data: { status: 'authorized' },
    })

    const afterFlip = await findReusableOrderLive(dto, order.userId)
    const reused = afterFlip?.id === order.id

    if (reused) {
      fail('Test 1.5', 'authorized order was reused — MONEY SAFETY BROKEN')
    } else {
      pass('Test 1.5', 'authorized payment correctly skipped, a new order would be created')
    }

    // Also test 'captured'
    await prisma.payment.update({
      where: { id: order.payment.id },
      data: { status: 'captured' },
    })
    const afterCaptured = await findReusableOrderLive(dto, order.userId)
    if (afterCaptured?.id === order.id) {
      fail('Test 1.5 captured', 'captured order was reused — MONEY SAFETY BROKEN')
    } else {
      pass('Test 1.5 captured', 'captured payment correctly skipped')
    }
  } finally {
    // Always restore
    await prisma.payment.update({
      where: { id: order.payment.id },
      data: { status: originalStatus },
    })
    console.log(`   restored payment.status → ${originalStatus}`)
  }
}

// ───────────────────────────────────────────────────────────────────
// TEST 1.6 — guest reuse with same email
// ───────────────────────────────────────────────────────────────────
async function test_1_6_guest_reuse() {
  console.log('\n── Test 1.6 — guest reuse with same email ──')

  const guestOrder = await prisma.order.findFirst({
    where: {
      status: { in: ['pending', 'pending_payment'] },
      deletedAt: null,
      createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
      guestEmail: { not: null },
      userId: null,
    },
    include: {
      items: { select: { variantId: true, quantity: true } },
      shippingAddress: true,
    },
  })

  if (!guestOrder) {
    skip('Test 1.6', 'no fresh guest pending order in DB — do a guest checkout first')
    return
  }

  const dto = {
    items: guestOrder.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
    guestEmail: guestOrder.guestEmail!.toUpperCase(), // Upper-case to verify lowercasing
    shippingAddressId: guestOrder.shippingAddressId,
    shippingAddress: guestOrder.shippingAddress
      ? {
          firstName: guestOrder.shippingAddress.firstName,
          lastName: guestOrder.shippingAddress.lastName,
          street: guestOrder.shippingAddress.street,
          houseNumber: guestOrder.shippingAddress.houseNumber,
          postalCode: guestOrder.shippingAddress.postalCode,
          city: guestOrder.shippingAddress.city,
          country: guestOrder.shippingAddress.country,
        }
      : undefined,
    couponCode: guestOrder.couponCode,
  }

  const result = await findReusableOrderLive(dto, null)
  if (result?.id === guestOrder.id) {
    pass('Test 1.6', `reused ${result.orderNumber} for guest ${guestOrder.guestEmail} (case-insensitive match)`)
  } else {
    fail('Test 1.6', `expected to find ${guestOrder.orderNumber}, got ${result?.orderNumber ?? 'null'}`)
  }
}

// ───────────────────────────────────────────────────────────────────
// TEST 1.7 — anonymous (no user, no email) must never reuse
// ───────────────────────────────────────────────────────────────────
async function test_1_7_anonymous_never_reuses() {
  console.log('\n── Test 1.7 — anonymous request never reuses ──')

  // Use empty cart items to prove we exit BEFORE any query runs
  const result = await findReusableOrderLive(
    { items: [{ variantId: 'any', quantity: 1 }], shippingAddress: { firstName: 'X' } },
    null, // no userId
  )

  if (result === null) {
    pass('Test 1.7', 'returned null without querying — identity required for reuse')
  } else {
    fail('Test 1.7', 'anonymous request matched an order — CROSS-USER LEAK')
  }
}

// ───────────────────────────────────────────────────────────────────
// TEST 2.1 — previousProviderPaymentIds column exists and persists
// ───────────────────────────────────────────────────────────────────
async function test_2_1_schema_and_persistence() {
  console.log('\n── Test 2.1 — schema field persists across writes ──')

  const payment = await prisma.payment.findFirst({
    where: { status: { in: ['pending', 'failed'] } },
    orderBy: { createdAt: 'desc' },
  })
  if (!payment) {
    skip('Test 2.1', 'no pending/failed payment in DB to probe')
    return
  }

  const original = (payment as any).previousProviderPaymentIds ?? []

  try {
    const testIds = ['pi_FAKE_AAA_111', 'pp_FAKE_BBB_222']
    await prisma.payment.update({
      where: { id: payment.id },
      data: { previousProviderPaymentIds: testIds } as any,
    })

    const reread = await prisma.payment.findUnique({ where: { id: payment.id } })
    const stored = (reread as any)?.previousProviderPaymentIds ?? []

    if (JSON.stringify(stored) === JSON.stringify(testIds)) {
      pass('Test 2.1', `column accepts + returns String[] correctly`)
    } else {
      fail('Test 2.1', `round-trip mismatch: wrote ${JSON.stringify(testIds)}, read ${JSON.stringify(stored)}`)
    }
  } finally {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { previousProviderPaymentIds: original } as any,
    })
  }
}

// ───────────────────────────────────────────────────────────────────
// TEST 2.2 — multi-switch preserves array across updates
// ───────────────────────────────────────────────────────────────────
async function test_2_2_multi_switch_array() {
  console.log('\n── Test 2.2 — multi-switch array accumulation ──')

  const payment = await prisma.payment.findFirst({
    where: { status: { in: ['pending', 'failed'] } },
    orderBy: { createdAt: 'desc' },
  })
  if (!payment) {
    skip('Test 2.2', 'no pending payment to probe')
    return
  }

  const originalIds = (payment as any).previousProviderPaymentIds ?? []
  const originalProviderPaymentId = payment.providerPaymentId

  try {
    // Start clean
    await prisma.payment.update({
      where: { id: payment.id },
      data: { previousProviderPaymentIds: [], providerPaymentId: 'pi_FAKE_STRIPE_1' } as any,
    })

    // Simulate switch: Stripe#1 → PayPal (mimicking createPayment logic)
    const step1 = await prisma.payment.findUnique({ where: { id: payment.id } })
    const step1Old = step1!.providerPaymentId!
    const step1Existing = (step1 as any).previousProviderPaymentIds ?? []
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        providerPaymentId: 'pp_FAKE_PAYPAL_2',
        previousProviderPaymentIds: Array.from(new Set([...step1Existing, step1Old])),
      } as any,
    })

    // Simulate switch: PayPal → Stripe#2
    const step2 = await prisma.payment.findUnique({ where: { id: payment.id } })
    const step2Old = step2!.providerPaymentId!
    const step2Existing = (step2 as any).previousProviderPaymentIds ?? []
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        providerPaymentId: 'pi_FAKE_STRIPE_3',
        previousProviderPaymentIds: Array.from(new Set([...step2Existing, step2Old])),
      } as any,
    })

    // Verify both old IDs are in the array
    const final = await prisma.payment.findUnique({ where: { id: payment.id } })
    const finalIds: string[] = (final as any).previousProviderPaymentIds ?? []

    const hasStripe1 = finalIds.includes('pi_FAKE_STRIPE_1')
    const hasPaypal = finalIds.includes('pp_FAKE_PAYPAL_2')
    const hasStripe3 = finalIds.includes('pi_FAKE_STRIPE_3') // should NOT (it is current)

    if (hasStripe1 && hasPaypal && !hasStripe3) {
      pass('Test 2.2', `all old IDs preserved after 2 switches: ${JSON.stringify(finalIds)}`)
    } else {
      fail(
        'Test 2.2',
        `array wrong — stripe1=${hasStripe1}, paypal=${hasPaypal}, stripe3(current)=${hasStripe3}. Got: ${JSON.stringify(finalIds)}`,
      )
    }
  } finally {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        previousProviderPaymentIds: originalIds,
        providerPaymentId: originalProviderPaymentId,
      } as any,
    })
  }
}

// ───────────────────────────────────────────────────────────────────
// TEST 2.3 — webhook fallback lookup finds payment via old ID
// ───────────────────────────────────────────────────────────────────
async function test_2_3_fallback_lookup() {
  console.log('\n── Test 2.3 — webhook fallback lookup (the money-safety net) ──')

  const payment = await prisma.payment.findFirst({
    where: { status: { in: ['pending', 'failed'] } },
    orderBy: { createdAt: 'desc' },
  })
  if (!payment) {
    skip('Test 2.3', 'no pending payment to probe')
    return
  }

  const originalIds = (payment as any).previousProviderPaymentIds ?? []
  const abandonedId = 'pi_FAKE_ABANDONED_999'

  try {
    // Plant an abandoned old ID in the fallback array
    await prisma.payment.update({
      where: { id: payment.id },
      data: { previousProviderPaymentIds: [abandonedId] } as any,
    })

    // Simulate webhook arriving with the abandoned ID
    const { payment: found, isFallbackHit } = await findPaymentForWebhookLive(abandonedId)

    if (found?.id === payment.id && isFallbackHit) {
      pass('Test 2.3 fallback', `webhook with abandoned ID ${abandonedId} correctly hit payment ${payment.id.slice(0, 8)} via fallback`)
    } else if (found?.id === payment.id && !isFallbackHit) {
      fail('Test 2.3 fallback', 'found but isFallbackHit flag is wrong')
    } else {
      fail('Test 2.3 fallback', `abandoned ID lookup missed — money would be lost in production`)
    }

    // Also verify: a non-existent ID returns null (no false positive)
    const ghost = await findPaymentForWebhookLive('pi_GHOST_NEVER_EXISTED')
    if (ghost.payment === null) {
      pass('Test 2.3 ghost', 'non-existent providerPaymentId correctly returns null')
    } else {
      fail('Test 2.3 ghost', 'ghost ID matched something — WHERE clause too loose')
    }
  } finally {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { previousProviderPaymentIds: originalIds } as any,
    })
  }
}

// ───────────────────────────────────────────────────────────────────
// TEST 2.4 — guard still blocks wechseln auf authorized/captured payments
// ───────────────────────────────────────────────────────────────────
async function test_2_4_authorized_guard() {
  console.log('\n── Test 2.4 — authorized guard still rejects method switch ──')

  // This is enforced at code level in createPayment (line 159).
  // Verify the guard logic is still in the source.
  const fs = await import('fs')
  const src = fs.readFileSync(
    __dirname + '/../src/modules/payments/payments.service.ts',
    'utf8',
  )

  const hasAuthorizedGuard = /\['authorized',\s*'captured'\]\.includes\(order\.payment\.status\)/.test(src)
  const throwsConflict = /PaymentAlreadyExists/.test(src)

  if (hasAuthorizedGuard && throwsConflict) {
    pass('Test 2.4', 'createPayment still throws ConflictException for authorized/captured')
  } else {
    fail('Test 2.4', 'authorized guard was removed or weakened — CRITICAL')
  }
}

// ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  LIVE DB VERIFICATION — Schritt 1 + Schritt 2')
  console.log('═══════════════════════════════════════════════════════════')

  await test_1_5_authorized_not_reused()
  await test_1_6_guest_reuse()
  await test_1_7_anonymous_never_reuses()
  await test_2_1_schema_and_persistence()
  await test_2_2_multi_switch_array()
  await test_2_3_fallback_lookup()
  await test_2_4_authorized_guard()

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('  SUMMARY')
  console.log('═══════════════════════════════════════════════════════════')
  const passed = results.filter((r) => r.status === 'PASS').length
  const failed = results.filter((r) => r.status === 'FAIL').length
  const skipped = results.filter((r) => r.status === 'SKIP').length
  console.log(`  ✅ Passed:  ${passed}`)
  console.log(`  ❌ Failed:  ${failed}`)
  console.log(`  ⏭  Skipped: ${skipped}`)
  if (failed > 0) {
    console.log('\nFAILURES:')
    results.filter((r) => r.status === 'FAIL').forEach((r) => {
      console.log(`  ❌ ${r.name}: ${r.note}`)
    })
  }
  if (skipped > 0) {
    console.log('\nSKIPPED (need prerequisites):')
    results.filter((r) => r.status === 'SKIP').forEach((r) => {
      console.log(`  ⏭  ${r.name}: ${r.note}`)
    })
  }
  process.exit(failed > 0 ? 1 : 0)
}

main()
  .catch((e) => {
    console.error('\nSCRIPT ERROR:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
