/**
 * Prepare a manual test of the public return flow.
 *
 * Finds a delivered order in the DB that you can click-test. If the order
 * does not already have a confirmationToken in notes, plants one so the
 * public URL works immediately.
 *
 * Non-destructive: only ADDS a confirmationToken, never removes real data.
 * If the order already has a token, reuses it unchanged.
 */
import { PrismaClient } from '@prisma/client'
import * as crypto from 'crypto'

const prisma = new PrismaClient()
const APP = 'http://localhost:3000'

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  MANUAL TEST — public return flow')
  console.log('═══════════════════════════════════════════════════════════\n')

  // Find a delivered order — prefer one within the 14-day window
  const deliveredOrders: any[] = await prisma.order.findMany({
    where: {
      status: 'delivered',
      deletedAt: null,
      shipment: { isNot: null },
    },
    include: {
      shipment: { select: { deliveredAt: true, trackingNumber: true } },
      user: { select: { email: true, firstName: true, passwordHash: true } },
      items: { select: { snapshotName: true, quantity: true } },
      returns: { select: { status: true, returnNumber: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  if (deliveredOrders.length === 0) {
    console.log('❌ No delivered orders found in DB.')
    console.log('   To test manually, you need at least one order in status=delivered')
    console.log('   with a shipment row attached.')
    return
  }

  // Show candidates
  console.log('── Delivered orders in DB ──')
  for (const o of deliveredOrders) {
    const daysSinceDelivery = o.shipment?.deliveredAt
      ? Math.floor((Date.now() - o.shipment.deliveredAt.getTime()) / (24 * 60 * 60 * 1000))
      : '?'
    const guestMarker = !o.user?.passwordHash ? ' 👤 STUB-GUEST' : ''
    const returnMarker = o.returns?.length > 0 ? ` ↩ HAS RETURN (${o.returns[0].status})` : ''
    console.log(`  ${o.orderNumber}  delivered ${daysSinceDelivery}d ago  ${o.user?.email}${guestMarker}${returnMarker}`)
  }

  // Pick the best candidate: delivered within 14 days, no active return, ideally a guest
  const WITHDRAWAL_DAYS = 14
  const now = Date.now()
  const eligible = deliveredOrders.filter((o: any) => {
    if (!o.shipment?.deliveredAt) return false
    const ageDays = (now - o.shipment.deliveredAt.getTime()) / (24 * 60 * 60 * 1000)
    if (ageDays > WITHDRAWAL_DAYS) return false
    const hasActiveReturn = o.returns?.some((r: any) => r.status !== 'refunded' && r.status !== 'rejected')
    if (hasActiveReturn) return false
    return true
  })

  if (eligible.length === 0) {
    console.log('\n⚠️  No delivered order is within the 14-day window AND without an active return.')
    console.log('   Options:')
    console.log('     (a) bump a shipment.deliveredAt to NOW() so it is fresh')
    console.log('     (b) clear the existing return row on one of the above')
    return
  }

  // Prefer a stub-guest order (that is what the fix is for)
  const pick = eligible.find((o: any) => !o.user?.passwordHash) ?? eligible[0]

  console.log(`\n✅ Using: ${pick.orderNumber}`)
  console.log(`   Customer:  ${pick.user?.email}  ${pick.user?.passwordHash ? '(real user)' : '(STUB GUEST)'}`)
  console.log(`   Items:     ${pick.items.length}`)
  console.log(`   Delivered: ${pick.shipment?.deliveredAt?.toISOString()}`)

  // Parse notes + plant token if missing
  let notes: any = {}
  try { notes = JSON.parse(pick.notes ?? '{}') } catch {}

  let token: string = notes.confirmationToken
  let planted = false
  if (!token) {
    token = crypto.randomUUID()
    notes.confirmationToken = token
    await prisma.order.update({
      where: { id: pick.id },
      data: { notes: JSON.stringify(notes) },
    })
    planted = true
    console.log('   📝 Planted a fresh confirmationToken for this test')
  } else {
    console.log('   📝 Reusing existing confirmationToken (no DB change)')
  }

  const url = `${APP}/de/return/${pick.id}?token=${token}`
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('  👉 CLICK-TEST URL (Chrome/Safari)')
  console.log('═══════════════════════════════════════════════════════════')
  console.log(`\n  ${url}\n`)
  console.log('  What you should see:')
  console.log('    1. Loading spinner (brief)')
  console.log('    2. Return page with MALAK Gold header')
  console.log('    3. Order number + deadline (X days left)')
  console.log('    4. List of items with +/- quantity buttons')
  console.log('    5. 5 return reasons (Falsche Größe, Defekt, ...)')
  console.log('    6. Notes textarea')
  console.log('    7. Sticky submit bar at bottom with "Absenden" button')
  console.log('\n  After clicking Absenden:')
  console.log('    → Green success screen with Retourennummer')
  console.log('    → Order status flips to "returned" in DB')
  console.log('    → Admin gets a notification (return.submitted event)')
  console.log()
  console.log('  Negative test — try changing one character in the token:')
  console.log(`    ${url.slice(0, -5)}WRONG`)
  console.log('    → Should show "Ungueltiger Link" / "Rückgabefrist abgelaufen"')
  console.log()

  if (planted) {
    console.log('  ⚠️  Token was newly planted. If you want to clean it up later:')
    console.log(`     DELETE: remove notes.confirmationToken from order ${pick.id}`)
  }

  console.log('\n  German version:')
  console.log(`    ${url}`)
  console.log('  English version:')
  console.log(`    ${url.replace('/de/', '/en/')}`)
  console.log('  Arabic version:')
  console.log(`    ${url.replace('/de/', '/ar/')}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
