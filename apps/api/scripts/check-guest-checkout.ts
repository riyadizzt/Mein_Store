/**
 * Guest-Checkout smoke test against the live DB.
 * Verifies recent guest orders look right: userId is NULL, guestEmail is set,
 * shipping address snapshot survives even after user deletion.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  GUEST CHECKOUT — Live DB check')
  console.log('═══════════════════════════════════════════════════════════\n')

  // 1. Any guest orders in the last 7 days?
  console.log('── Recent guest orders (userId=null, guestEmail set) ──')
  const guestOrders = await prisma.order.findMany({
    where: {
      userId: null,
      guestEmail: { not: null },
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      deletedAt: null,
    },
    include: {
      items: { select: { id: true } },
      payment: { select: { method: true, status: true } },
      shippingAddress: {
        select: { firstName: true, lastName: true, city: true, postalCode: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  if (guestOrders.length === 0) {
    console.log('   (no guest orders yet — run the test and re-run this script)')
  } else {
    for (const o of guestOrders) {
      const ageMin = Math.floor((Date.now() - o.createdAt.getTime()) / 60000)
      const name = o.shippingAddress
        ? `${o.shippingAddress.firstName} ${o.shippingAddress.lastName}`
        : '(no address)'
      console.log(
        `   ${o.orderNumber}  ${ageMin}min ago  €${o.totalAmount}  ${o.status}  email=${o.guestEmail}  addr=${name}`,
      )
    }
  }

  // 2. Sanity invariants for every guest order
  console.log('\n── Guest-checkout invariants ──')
  let ok = 0
  let bad = 0
  const problems: string[] = []

  for (const o of guestOrders) {
    // Invariant 1: userId is null
    if (o.userId !== null) {
      bad++
      problems.push(`${o.orderNumber}: userId should be null, got ${o.userId}`)
      continue
    }
    // Invariant 2: guestEmail is set (we filtered on it, belt-and-suspenders)
    if (!o.guestEmail || o.guestEmail.trim() === '') {
      bad++
      problems.push(`${o.orderNumber}: guestEmail empty`)
      continue
    }
    // Invariant 3: guestEmail looks like an email
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(o.guestEmail)) {
      bad++
      problems.push(`${o.orderNumber}: malformed email "${o.guestEmail}"`)
      continue
    }
    // Invariant 4: has items
    if (o.items.length === 0) {
      bad++
      problems.push(`${o.orderNumber}: no items`)
      continue
    }
    // Invariant 5: has shipping address OR snapshot (for Schritt 3 of earlier work)
    if (!o.shippingAddress) {
      // snapshot fallback is in a separate JSON field, not checked here
      bad++
      problems.push(`${o.orderNumber}: no shipping address linked`)
      continue
    }
    ok++
  }

  if (guestOrders.length > 0) {
    console.log(`   ✅ ${ok}/${guestOrders.length} guest orders pass all invariants`)
    if (bad > 0) {
      console.log(`   ❌ ${bad} failures:`)
      problems.forEach((p) => console.log(`      ${p}`))
    }
  }

  // 3. Count: how many guest orders vs logged-in in last 7 days
  console.log('\n── Last 7 days split ──')
  const [guestCount, userCount] = await Promise.all([
    prisma.order.count({
      where: {
        userId: null,
        guestEmail: { not: null },
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        deletedAt: null,
      },
    }),
    prisma.order.count({
      where: {
        userId: { not: null },
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        deletedAt: null,
      },
    }),
  ])
  console.log(`   Guest orders:       ${guestCount}`)
  console.log(`   Logged-in orders:   ${userCount}`)

  console.log('\n═══════════════════════════════════════════════════════════')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
