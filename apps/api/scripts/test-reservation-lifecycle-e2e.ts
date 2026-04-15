/**
 * LIVE end-to-end test of the full reservation lifecycle after the
 * 15.04.2026 fix. Runs against Supabase with a REAL order created via
 * the NestJS service chain, then exercises:
 *
 *   1. Order creation → reservation.reserve() called → StockReservation
 *      row RESERVED, inventory.quantityReserved += qty, notes carries
 *      reservationIds (Bug #1 fix)
 *
 *   2a. Stripe webhook path: handlePaymentSuccess() → emits
 *       ORDER_EVENTS.CONFIRMED → InventoryListener.handleOrderConfirmed
 *       → reservation.confirm() → status=CONFIRMED, onHand -= qty,
 *       reserved -= qty
 *
 *   2b. Vorkasse admin manual path: markAsCaptured() → now also emits
 *       ORDER_EVENTS.CONFIRMED (Bug #2 fix) → same inventory effect
 *
 *   3. Order cancellation → emits ORDER_EVENTS.CANCELLED →
 *      reservation.release() → status=RELEASED, reserved -= qty,
 *      onHand unchanged
 *
 * Non-destructive: every row the script creates is hard-deleted at the
 * end, even on assertion failure.
 */
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../src/app.module'
import { OrdersService } from '../src/modules/orders/orders.service'
import { PaymentsService } from '../src/modules/payments/payments.service'
import { PrismaService } from '../src/prisma/prisma.service'

const PASS = (m: string) => console.log(`✅ ${m}`)
const FAIL = (m: string) => { console.error(`❌ ${m}`); process.exitCode = 1 }
const INFO = (m: string) => console.log(`   ${m}`)

interface TestContext {
  app: any
  prisma: PrismaService
  ordersService: OrdersService
  paymentsService: PaymentsService
  categoryId: string
  warehouseId: string
  userId: string
  variantIdsToCleanup: string[]
  productIdsToCleanup: string[]
  orderIdsToCleanup: string[]
}

async function setupFixtures(ctx: TestContext) {
  const cat = await ctx.prisma.category.findFirst({ where: { isActive: true } })
  if (!cat) throw new Error('no active category')
  ctx.categoryId = cat.id

  const wh = await ctx.prisma.warehouse.findFirst({ where: { isDefault: true, isActive: true } })
  if (!wh) throw new Error('no default warehouse')
  ctx.warehouseId = wh.id

  // Use any existing real user (we'll link orders to them; they won't get emails because this is a test)
  const anyUser = await ctx.prisma.user.findFirst({ where: { role: 'super_admin' } })
  if (!anyUser) throw new Error('no super_admin user')
  ctx.userId = anyUser.id

  INFO(`Category:  ${cat.id.slice(0, 8)}  "${(await ctx.prisma.category.findUnique({ where: { id: cat.id }, include: { translations: true } }))?.translations[0]?.name}"`)
  INFO(`Warehouse: ${wh.id.slice(0, 8)}  "${wh.name}"`)
  INFO(`User:      ${anyUser.id.slice(0, 8)}  "${anyUser.email}"`)
}

async function createTestProduct(ctx: TestContext, tag: string) {
  const slug = `e2e-lifecycle-${tag}-${Date.now()}`
  const product = await ctx.prisma.product.create({
    data: {
      slug,
      categoryId: ctx.categoryId,
      basePrice: 29.99,
      isActive: false,
      translations: {
        create: [
          { language: 'de', name: `E2E Lifecycle ${tag}` },
          { language: 'en', name: `E2E Lifecycle ${tag}` },
          { language: 'ar', name: `E2E Lifecycle ${tag}` },
        ],
      },
      variants: {
        create: [{
          sku: `E2E-LC-${tag}-${Date.now()}`,
          barcode: `E2E-LC-${tag}-${Date.now()}`,
          color: 'Testfarbe',
          size: 'M',
          inventory: {
            create: [{
              warehouseId: ctx.warehouseId,
              quantityOnHand: 10,
              quantityReserved: 0,
            }],
          },
        }],
      },
    },
    include: { variants: true },
  })
  ctx.productIdsToCleanup.push(product.id)
  ctx.variantIdsToCleanup.push(product.variants[0].id)
  return product
}

async function createOrder(ctx: TestContext, variantId: string, qty = 1) {
  const result = await ctx.ordersService.create(
    {
      items: [{ variantId, warehouseId: ctx.warehouseId, quantity: qty }],
      countryCode: 'DE',
      shippingAddress: {
        firstName: 'E2E',
        lastName: 'Test',
        street: 'Teststraße',
        houseNumber: '1',
        postalCode: '10115',
        city: 'Berlin',
        country: 'DE',
      },
    } as any,
    ctx.userId,
    `e2e-${Date.now()}`,
  )
  ctx.orderIdsToCleanup.push((result as any).id)
  return result as any
}

async function readInventory(ctx: TestContext, variantId: string) {
  return ctx.prisma.inventory.findUnique({
    where: { variantId_warehouseId: { variantId, warehouseId: ctx.warehouseId } },
    select: { quantityOnHand: true, quantityReserved: true },
  })
}

async function readReservations(ctx: TestContext, orderId: string) {
  return ctx.prisma.stockReservation.findMany({
    where: { orderId },
    select: { id: true, status: true, quantity: true },
  })
}

async function readOrderNotes(ctx: TestContext, orderId: string) {
  const o = await ctx.prisma.order.findUnique({ where: { id: orderId }, select: { notes: true, status: true } })
  let notes: any = {}
  try { notes = JSON.parse(o?.notes ?? '{}') } catch {}
  return { notes, status: o?.status }
}

// ───────────────────────────────────────────────────────────────
// TEST 1 — STRIPE WEBHOOK PATH
// ───────────────────────────────────────────────────────────────
async function testStripeFlow(ctx: TestContext) {
  console.log(`\n══ TEST 1: Stripe webhook path ══\n`)

  // Fixture: create a product with 10 in stock
  const product = await createTestProduct(ctx, 'stripe')
  const variantId = product.variants[0].id
  INFO(`Product: ${product.slug}`)
  INFO(`Variant: ${product.variants[0].sku}`)

  const before = await readInventory(ctx, variantId)
  INFO(`BEFORE: onHand=${before?.quantityOnHand}  reserved=${before?.quantityReserved}`)

  // ── Step 1: Create order ──────────────────────────────────────
  const order = await createOrder(ctx, variantId, 1)
  INFO(`Order created: ${order.orderNumber}  id=${order.id.slice(0, 8)}`)

  const afterCreate = await readInventory(ctx, variantId)
  const reservationsAfterCreate = await readReservations(ctx, order.id)
  const { notes: notesAfterCreate } = await readOrderNotes(ctx, order.id)

  if (afterCreate?.quantityOnHand === 10) PASS('Step 1: onHand still 10 (not decremented yet)')
  else FAIL(`Step 1: onHand wrong, expected 10 got ${afterCreate?.quantityOnHand}`)

  if (afterCreate?.quantityReserved === 1) PASS('Step 1: reserved incremented to 1')
  else FAIL(`Step 1: reserved wrong, expected 1 got ${afterCreate?.quantityReserved}`)

  if (reservationsAfterCreate.length === 1 && reservationsAfterCreate[0].status === 'RESERVED') {
    PASS(`Step 1: StockReservation row created with status=RESERVED`)
  } else {
    FAIL(`Step 1: expected 1 RESERVED row, got ${JSON.stringify(reservationsAfterCreate)}`)
  }

  if (Array.isArray(notesAfterCreate.reservationIds) && notesAfterCreate.reservationIds.length === 1) {
    PASS(`Step 1: notes.reservationIds populated (Bug #1 fix works): ${notesAfterCreate.reservationIds[0].slice(0, 8)}`)
  } else {
    FAIL(`Step 1: notes.reservationIds MISSING — Bug #1 fix broken: ${JSON.stringify(notesAfterCreate.reservationIds)}`)
  }

  // ── Step 2: Create a fake payment row + simulate Stripe webhook ─
  const payment = await ctx.prisma.payment.create({
    data: {
      orderId: order.id,
      provider: 'STRIPE',
      method: 'stripe_card',
      status: 'pending',
      amount: order.totalAmount,
      providerPaymentId: `pi_e2e_${Date.now()}`,
    },
  })
  INFO(`Fake payment row: ${payment.id.slice(0, 8)}  providerId=${payment.providerPaymentId}`)

  // Call handlePaymentSuccess → should emit ORDER_EVENTS.CONFIRMED
  await ctx.paymentsService.handlePaymentSuccess(payment.providerPaymentId!, 'STRIPE', 'e2e-corr-stripe')

  // Give event emitter a tick
  await new Promise((r) => setTimeout(r, 500))

  const afterPayment = await readInventory(ctx, variantId)
  const reservationsAfterPayment = await readReservations(ctx, order.id)
  const { status: orderStatusAfterPayment } = await readOrderNotes(ctx, order.id)

  INFO(`AFTER PAYMENT: onHand=${afterPayment?.quantityOnHand}  reserved=${afterPayment?.quantityReserved}  order.status=${orderStatusAfterPayment}`)

  if (afterPayment?.quantityOnHand === 9) {
    PASS(`Step 2: onHand decremented from 10 → 9 (reservation.confirm worked)`)
  } else {
    FAIL(`Step 2: onHand wrong, expected 9 got ${afterPayment?.quantityOnHand}`)
  }

  if (afterPayment?.quantityReserved === 0) {
    PASS(`Step 2: reserved decremented back to 0`)
  } else {
    FAIL(`Step 2: reserved wrong, expected 0 got ${afterPayment?.quantityReserved}`)
  }

  if (reservationsAfterPayment[0].status === 'CONFIRMED') {
    PASS(`Step 2: reservation status = CONFIRMED`)
  } else {
    FAIL(`Step 2: reservation status wrong: ${reservationsAfterPayment[0].status}`)
  }

  if (orderStatusAfterPayment === 'confirmed') {
    PASS(`Step 2: order.status = confirmed`)
  } else {
    FAIL(`Step 2: order.status wrong: ${orderStatusAfterPayment}`)
  }
}

// ───────────────────────────────────────────────────────────────
// TEST 2 — VORKASSE MANUAL PATH (the fix for Bug #2)
// ───────────────────────────────────────────────────────────────
async function testVorkasseFlow(ctx: TestContext) {
  console.log(`\n══ TEST 2: Vorkasse manual-confirm path (Bug #2 fix) ══\n`)

  const product = await createTestProduct(ctx, 'vorkasse')
  const variantId = product.variants[0].id
  const order = await createOrder(ctx, variantId, 2)
  INFO(`Order: ${order.orderNumber}`)

  const before = await readInventory(ctx, variantId)
  INFO(`BEFORE: onHand=${before?.quantityOnHand}  reserved=${before?.quantityReserved}`)

  if (before?.quantityReserved !== 2) FAIL(`Vorkasse pre-check: expected reserved=2, got ${before?.quantityReserved}`)

  // Create a VORKASSE payment row
  await ctx.prisma.payment.create({
    data: {
      orderId: order.id,
      provider: 'VORKASSE',
      method: 'vorkasse',
      status: 'pending',
      amount: order.totalAmount,
    },
  })

  // Admin manually confirms Vorkasse payment
  await ctx.paymentsService.markAsCaptured(order.id)
  await new Promise((r) => setTimeout(r, 500))

  const after = await readInventory(ctx, variantId)
  const reservations = await readReservations(ctx, order.id)
  const { status: orderStatus } = await readOrderNotes(ctx, order.id)
  INFO(`AFTER markAsCaptured: onHand=${after?.quantityOnHand}  reserved=${after?.quantityReserved}  order.status=${orderStatus}`)

  if (after?.quantityOnHand === 8) PASS(`Vorkasse Step: onHand 10 → 8 (Bug #2 fix works)`)
  else FAIL(`Vorkasse: onHand wrong, expected 8 got ${after?.quantityOnHand}`)

  if (after?.quantityReserved === 0) PASS(`Vorkasse Step: reserved → 0`)
  else FAIL(`Vorkasse: reserved wrong, expected 0 got ${after?.quantityReserved}`)

  if (reservations[0]?.status === 'CONFIRMED') PASS(`Vorkasse Step: reservation CONFIRMED`)
  else FAIL(`Vorkasse: reservation status wrong: ${reservations[0]?.status}`)

  if (orderStatus === 'confirmed') PASS(`Vorkasse Step: order.status = confirmed`)
  else FAIL(`Vorkasse: order.status wrong: ${orderStatus}`)
}

// ───────────────────────────────────────────────────────────────
// TEST 3 — CANCELLATION PATH
// ───────────────────────────────────────────────────────────────
async function testCancellationFlow(ctx: TestContext) {
  console.log(`\n══ TEST 3: Cancellation (reservation.release) ══\n`)

  const product = await createTestProduct(ctx, 'cancel')
  const variantId = product.variants[0].id
  const order = await createOrder(ctx, variantId, 3)
  INFO(`Order: ${order.orderNumber}`)

  const before = await readInventory(ctx, variantId)
  INFO(`BEFORE cancel: onHand=${before?.quantityOnHand}  reserved=${before?.quantityReserved}`)

  if (before?.quantityReserved !== 3) FAIL(`Cancel pre-check: expected reserved=3, got ${before?.quantityReserved}`)

  // Cancellation goes through updateStatus('cancelled') — there's no dedicated cancel() method
  await ctx.ordersService.updateStatus(
    order.id,
    { status: 'cancelled', notes: 'e2e test cancellation' } as any,
    'e2e-source',
    ctx.userId,
    'e2e-corr-cancel',
  )
  await new Promise((r) => setTimeout(r, 500))

  const after = await readInventory(ctx, variantId)
  const reservations = await readReservations(ctx, order.id)
  const { status: orderStatus } = await readOrderNotes(ctx, order.id)
  INFO(`AFTER cancel: onHand=${after?.quantityOnHand}  reserved=${after?.quantityReserved}  order.status=${orderStatus}`)

  if (after?.quantityOnHand === 10) PASS(`Cancel: onHand unchanged at 10 (stock was never sold)`)
  else FAIL(`Cancel: onHand wrong, expected 10 got ${after?.quantityOnHand}`)

  if (after?.quantityReserved === 0) PASS(`Cancel: reserved released back to 0`)
  else FAIL(`Cancel: reserved wrong, expected 0 got ${after?.quantityReserved}`)

  if (reservations[0]?.status === 'RELEASED') PASS(`Cancel: reservation status = RELEASED`)
  else FAIL(`Cancel: reservation status wrong: ${reservations[0]?.status}`)

  if (orderStatus === 'cancelled') PASS(`Cancel: order.status = cancelled`)
  else FAIL(`Cancel: order.status wrong: ${orderStatus}`)
}

// ───────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })

  const ctx: TestContext = {
    app,
    prisma: app.get(PrismaService),
    ordersService: app.get(OrdersService),
    paymentsService: app.get(PaymentsService),
    categoryId: '',
    warehouseId: '',
    userId: '',
    variantIdsToCleanup: [],
    productIdsToCleanup: [],
    orderIdsToCleanup: [],
  }

  console.log('\n── Fixtures ─────────────────────────────────\n')
  try {
    await setupFixtures(ctx)

    await testStripeFlow(ctx)
    await testVorkasseFlow(ctx)
    await testCancellationFlow(ctx)
  } catch (e: any) {
    FAIL(`UNEXPECTED: ${e.message}`)
    console.error(e)
  } finally {
    // ── Cleanup ────────────────────────────────────────────────
    console.log(`\n── Teardown ─────────────────────────────────\n`)
    for (const orderId of ctx.orderIdsToCleanup) {
      try {
        await ctx.prisma.payment.deleteMany({ where: { orderId } })
        await ctx.prisma.stockReservation.deleteMany({ where: { orderId } })
        await ctx.prisma.inventoryMovement.deleteMany({ where: { referenceId: orderId } })
        await ctx.prisma.orderStatusHistory.deleteMany({ where: { orderId } })
        await ctx.prisma.orderItem.deleteMany({ where: { orderId } })
        await ctx.prisma.order.delete({ where: { id: orderId } })
        INFO(`  ✓ deleted order ${orderId.slice(0, 8)}`)
      } catch (e: any) {
        console.error(`  ✗ cleanup order ${orderId.slice(0, 8)}: ${e.message}`)
      }
    }
    for (const productId of ctx.productIdsToCleanup) {
      try {
        await ctx.prisma.inventoryMovement.deleteMany({ where: { variantId: { in: ctx.variantIdsToCleanup } } })
        await ctx.prisma.stockReservation.deleteMany({ where: { variantId: { in: ctx.variantIdsToCleanup } } })
        await ctx.prisma.inventory.deleteMany({ where: { variantId: { in: ctx.variantIdsToCleanup } } })
        await ctx.prisma.product.delete({ where: { id: productId } })
        INFO(`  ✓ deleted product ${productId.slice(0, 8)}`)
      } catch (e: any) {
        console.error(`  ✗ cleanup product ${productId.slice(0, 8)}: ${e.message}`)
      }
    }
    await app.close()
  }

  if (process.exitCode === 1) {
    console.log('\n❌ Some checks FAILED')
  } else {
    console.log('\n✅ All reservation lifecycle checks passed')
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
