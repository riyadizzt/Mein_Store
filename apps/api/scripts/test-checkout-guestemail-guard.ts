/**
 * E2E test for the guest-email checkout guard (14.04.2026 fix).
 *
 * Reproduces the exact regression from the 5-anonymous-orders incident:
 *   - Guest checkout with no email → backend must reject (new)
 *   - Guest checkout WITH email → accepted + stub-user created (unchanged)
 *   - Logged-in checkout → accepted without email (unchanged)
 *   - Reuse works for same guestEmail + same cart (unchanged)
 *   - Payments service passes customerEmail=undefined for missing email
 *     (verified via the orders service rejecting anonymous before we even
 *     reach the payment layer — if the guard works, Stripe never sees '')
 *
 * Cleans up all created rows at the end. Runs against the live Supabase DB
 * but touches only rows whose email matches the unique test pattern.
 */

import { NestFactory } from '@nestjs/core'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { OrdersService } from '../src/modules/orders/orders.service'
import { BadRequestException } from '@nestjs/common'

type R = { name: string; status: 'PASS' | 'FAIL'; note?: string }
const results: R[] = []
const pass = (n: string, note?: string) => {
  results.push({ name: n, status: 'PASS', note })
  console.log(`  ✅ ${n}${note ? ` — ${note}` : ''}`)
}
const fail = (n: string, note: string) => {
  results.push({ name: n, status: 'FAIL', note })
  console.log(`  ❌ ${n} — ${note}`)
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  CHECKOUT GUEST-EMAIL GUARD — E2E test')
  console.log('═══════════════════════════════════════════════════════════\n')

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  })
  const prisma = app.get(PrismaService)
  const ordersService = app.get(OrdersService)

  const unique = Date.now()
  const testGuestEmail = `checkout-guard-${unique}@malak-test.local`
  const createdOrderIds: string[] = []
  const createdUserIds: string[] = []

  try {
    // ── Setup: pick a real product variant with plenty of stock ──
    // We need quantity >= 10 because the test creates up to 4 orders (each
    // reserving stock) and the previous run's reservations may still be
    // held briefly during cleanup. Picking a high-stock variant avoids
    // flakiness on repeated runs.
    console.log('── 0. Setup: find a live variant with stock headroom ──')
    const candidates = await prisma.productVariant.findMany({
      where: { isActive: true, product: { isActive: true } },
      include: {
        inventory: { select: { warehouseId: true, quantityOnHand: true, quantityReserved: true } },
      },
      take: 50,
    })
    const variant = candidates.find((v) => {
      const inv = v.inventory.find((i) => i.quantityOnHand - i.quantityReserved >= 10)
      return !!inv
    })
    if (!variant) {
      fail('setup', 'no active variant with >= 10 available stock found')
      return
    }
    const stockInv = variant.inventory.find((i) => i.quantityOnHand - i.quantityReserved >= 10)!
    const variantId = variant.id
    const warehouseId = stockInv.warehouseId
    const available = stockInv.quantityOnHand - stockInv.quantityReserved
    pass('variant found', `${variantId.slice(0, 8)} @ ${warehouseId.slice(0, 8)} (available=${available})`)

    const baseAddress = {
      firstName: 'Guard',
      lastName: 'Test',
      street: 'Teststraße',
      houseNumber: '1',
      postalCode: '10115',
      city: 'Berlin',
      country: 'DE',
    }
    const baseDto = {
      items: [{ variantId, warehouseId, quantity: 1 }],
      shippingAddress: baseAddress,
      countryCode: 'DE',
      locale: 'de',
    }

    // ── 1. Anonymous order (no userId, no guestEmail) → MUST reject ──
    console.log('\n── 1. Anonymous guest without email → must reject ──')
    try {
      await ordersService.create(baseDto as any, null, 'test-corr-1', undefined)
      fail('anonymous rejection', 'expected BadRequest, got success')
    } catch (err) {
      if (err instanceof BadRequestException) {
        const resp = err.getResponse() as any
        if (resp?.error === 'GuestEmailRequired') {
          pass('anonymous rejection', `correctly threw GuestEmailRequired`)
          // Verify 3-language error message
          if (resp.message?.de && resp.message?.en && resp.message?.ar) {
            pass('error i18n', 'DE/EN/AR messages present')
          } else {
            fail('error i18n', `missing locales: ${JSON.stringify(resp.message)}`)
          }
        } else {
          fail('anonymous rejection', `wrong error code: ${resp?.error}`)
        }
      } else {
        fail('anonymous rejection', `wrong exception type: ${(err as Error).message}`)
      }
    }

    // ── 2. Anonymous with empty-string guestEmail → MUST reject (no bypass) ──
    console.log('\n── 2. Empty-string guestEmail → must reject ──')
    try {
      await ordersService.create({ ...baseDto, guestEmail: '   ' } as any, null, 'test-corr-2', undefined)
      fail('empty-string rejection', 'expected BadRequest, got success')
    } catch (err) {
      if (err instanceof BadRequestException && (err.getResponse() as any)?.error === 'GuestEmailRequired') {
        pass('empty-string rejection', 'whitespace-only email correctly rejected')
      } else {
        fail('empty-string rejection', `wrong error: ${(err as Error).message}`)
      }
    }

    // ── 3. Guest WITH valid email → accepted + stub user created ──
    console.log('\n── 3. Valid guest email → must accept and create stub user ──')
    const order1 = await ordersService.create(
      { ...baseDto, guestEmail: testGuestEmail } as any,
      null,
      'test-corr-3',
      undefined,
    )
    if (order1 && order1.id) {
      createdOrderIds.push(order1.id)
      pass('valid guest accepted', `orderNumber=${order1.orderNumber}`)

      // Verify stub user was created
      const order1Full = await prisma.order.findUnique({
        where: { id: order1.id },
        include: { user: true },
      })
      if (order1Full?.user && order1Full.user.email === testGuestEmail && !order1Full.user.passwordHash) {
        createdUserIds.push(order1Full.user.id)
        pass('stub user created', `user.id=${order1Full.user.id.slice(0, 8)}`)
      } else {
        fail('stub user', `no stub user linked. user=${JSON.stringify(order1Full?.user)}`)
      }
      if (order1Full?.userId && !order1Full.guestEmail) {
        pass('order identity resolved', `userId set, guestEmail null (stub pattern)`)
      } else {
        fail('order identity', `userId=${order1Full?.userId}, guestEmail=${order1Full?.guestEmail}`)
      }
    } else {
      fail('valid guest', 'create returned null')
    }

    // ── 4. Second checkout attempt (same cart + email) → must REUSE ──
    console.log('\n── 4. Second attempt same cart+email → must reuse order ──')
    const order2 = await ordersService.create(
      { ...baseDto, guestEmail: testGuestEmail } as any,
      null,
      'test-corr-4',
      undefined,
    )
    if (order2 && order2.id === order1.id) {
      pass('reuse works', `same order ${order1.orderNumber} returned`)
    } else if (order2 && order2.id !== order1.id) {
      createdOrderIds.push(order2.id)
      fail('reuse broken', `new order ${order2.orderNumber} created instead of reusing ${order1.orderNumber}`)
    } else {
      fail('reuse works', 'create returned null')
    }

    // ── 5. Third attempt with DIFFERENT email → must NOT reuse ──
    console.log('\n── 5. Different email → must create new order ──')
    const otherEmail = `checkout-guard-other-${unique}@malak-test.local`
    const order3 = await ordersService.create(
      { ...baseDto, guestEmail: otherEmail } as any,
      null,
      'test-corr-5',
      undefined,
    )
    if (order3 && order3.id !== order1.id) {
      createdOrderIds.push(order3.id)
      pass('different-email creates new', `new orderNumber=${order3.orderNumber}`)
      const order3User = await prisma.user.findUnique({ where: { email: otherEmail } })
      if (order3User) createdUserIds.push(order3User.id)
    } else {
      fail('different email', `unexpectedly reused or null: ${JSON.stringify(order3)}`)
    }

    // ── 6. Case-insensitivity: uppercase email → must match stub user ──
    console.log('\n── 6. Uppercase email variant → must reuse stub user ──')
    const upperEmail = testGuestEmail.toUpperCase()
    const order4 = await ordersService.create(
      { ...baseDto, guestEmail: upperEmail } as any,
      null,
      'test-corr-6',
      undefined,
    )
    if (order4 && order4.id === order1.id) {
      pass('case-insensitive reuse', 'uppercase email matched stub user')
    } else {
      // Even if reuse didn't hit (fingerprint mismatch), the stub user should still match
      const order4Full = await prisma.order.findUnique({
        where: { id: order4.id },
        include: { user: true },
      })
      if (order4Full?.user?.email === testGuestEmail) {
        pass('case-insensitive stub match', 'lowercased to existing user')
        if (order4.id !== order1.id) createdOrderIds.push(order4.id)
      } else {
        fail('case-insensitive', `new stub created with mixed case: ${order4Full?.user?.email}`)
      }
    }

    // ── 7. Verify no anonymous orders leaked into the DB for this run ──
    console.log('\n── 7. Anonymous-leak check ──')
    const anonOrders = await prisma.order.findMany({
      where: {
        userId: null,
        guestEmail: null,
        createdAt: { gte: new Date(Date.now() - 60 * 1000) },
      },
      select: { id: true, orderNumber: true },
    })
    if (anonOrders.length === 0) {
      pass('no anonymous orders leaked', 'guard blocked all anon paths')
    } else {
      fail('anonymous leak', `${anonOrders.length} anon orders found: ${anonOrders.map(o => o.orderNumber).join(', ')}`)
    }
  } catch (err) {
    fail('uncaught error', (err as Error).message)
    console.error(err)
  } finally {
    console.log('\n── Cleanup ──')
    if (createdOrderIds.length > 0) {
      // Cancel the reservations first (delete order items to release stock)
      const delItems = await prisma.orderItem.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      }).catch(() => ({ count: 0 }))
      console.log(`  🧹 deleted ${delItems.count} order items`)

      const delPayments = await prisma.payment.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      }).catch(() => ({ count: 0 }))
      console.log(`  🧹 deleted ${delPayments.count} payment rows`)

      const delHistory = await prisma.orderStatusHistory.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      }).catch(() => ({ count: 0 }))
      console.log(`  🧹 deleted ${delHistory.count} status history rows`)

      const delOrders = await prisma.order.deleteMany({
        where: { id: { in: createdOrderIds } },
      }).catch((e) => { console.log(`  ⚠ order delete failed: ${e.message}`); return { count: 0 } })
      console.log(`  🧹 deleted ${delOrders.count} orders`)
    }

    // Release any stock reservations that might still be held.
    // Direct deletion would leak the `quantityReserved` counter on
    // InventoryItem — we must decrement it first, then delete the audit rows.
    if (createdOrderIds.length > 0) {
      try {
        const reservations = await prisma.stockReservation.findMany({
          where: { orderId: { in: createdOrderIds }, status: 'RESERVED' },
          select: { id: true, variantId: true, warehouseId: true, quantity: true },
        })
        for (const r of reservations) {
          await prisma.inventory.updateMany({
            where: { variantId: r.variantId, warehouseId: r.warehouseId },
            data: { quantityReserved: { decrement: r.quantity } },
          }).catch(() => {})
        }
        const delRes = await prisma.stockReservation.deleteMany({
          where: { orderId: { in: createdOrderIds } },
        })
        console.log(`  🧹 released ${reservations.length} reservations + deleted ${delRes.count} rows`)
      } catch (e) {
        console.log(`  ⚠ reservation cleanup failed: ${(e as Error).message}`)
      }
    }

    if (createdUserIds.length > 0) {
      const delUsers = await prisma.user.deleteMany({
        where: { id: { in: createdUserIds }, email: { contains: `${unique}` } },
      }).catch((e) => { console.log(`  ⚠ user delete failed: ${e.message}`); return { count: 0 } })
      console.log(`  🧹 deleted ${delUsers.count} stub users`)
    }
    await app.close()
  }

  console.log('\n═══════════════════════════════════════════════════════════')
  const p = results.filter((r) => r.status === 'PASS').length
  const f = results.filter((r) => r.status === 'FAIL').length
  console.log(`  RESULT: ${p} passed, ${f} failed`)
  console.log('═══════════════════════════════════════════════════════════')
  process.exit(f > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('fatal:', e)
  process.exit(1)
})
