/**
 * Live DB test for the 15-minute reuse-window cutoff.
 *
 * Picks a recent pending/pending_payment order, then verifies that the
 * findReusableOrder query (copied verbatim below) returns it when fresh,
 * and does NOT return it after bumping created_at past the 15-min cutoff.
 *
 * Restores the original created_at at the end — safe to run repeatedly.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const REUSE_WINDOW_MINUTES = 15

async function runReuseQuery(userId: string | null, guestEmail: string | null) {
  const cutoff = new Date()
  cutoff.setMinutes(cutoff.getMinutes() - REUSE_WINDOW_MINUTES)

  return prisma.order.findMany({
    where: {
      deletedAt: null,
      status: { in: ['pending', 'pending_payment'] },
      createdAt: { gte: cutoff },
      ...(userId ? { userId } : { guestEmail: guestEmail ?? undefined }),
    },
    include: {
      items: { select: { variantId: true, quantity: true } },
      payment: { select: { status: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  })
}

async function main() {
  console.log('── STEP 1: Find a candidate pending order ──')
  const existing = await prisma.order.findFirst({
    where: {
      status: { in: ['pending', 'pending_payment'] },
      deletedAt: null,
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }, // within last 1h
    },
    orderBy: { createdAt: 'desc' },
  })

  if (!existing) {
    console.log('❌ No fresh pending order in DB. Create one through the checkout first.')
    console.log('   (Checkout → Payment step → close tab → then re-run this script)')
    process.exit(1)
  }

  const originalCreatedAt = existing.createdAt
  console.log(`✅ Found order: ${existing.orderNumber} (id=${existing.id.slice(0, 8)})`)
  console.log(`   userId=${existing.userId ?? '(null)'}  guestEmail=${existing.guestEmail ?? '(null)'}`)
  console.log(`   status=${existing.status}  created_at=${originalCreatedAt.toISOString()}`)
  console.log()

  try {
    // ── TEST 1: fresh order IS within the window ──
    console.log('── STEP 2: Query with fresh created_at ──')
    const freshResults = await runReuseQuery(existing.userId, existing.guestEmail)
    const foundFresh = freshResults.some((o) => o.id === existing.id)
    console.log(`   query returned ${freshResults.length} candidate(s)`)
    console.log(
      foundFresh
        ? `✅ PASS: fresh order is in the result set (reuse would work)`
        : `❌ FAIL: fresh order NOT in result set`,
    )
    console.log()

    // ── TEST 2: bump created_at past 15 min ──
    console.log('── STEP 3: Set created_at to 20 minutes ago ──')
    const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000)
    await prisma.order.update({
      where: { id: existing.id },
      data: { createdAt: twentyMinAgo },
    })
    console.log(`   updated created_at → ${twentyMinAgo.toISOString()}`)
    console.log()

    console.log('── STEP 4: Query again — order should now be OUT of the window ──')
    const staleResults = await runReuseQuery(existing.userId, existing.guestEmail)
    const foundStale = staleResults.some((o) => o.id === existing.id)
    console.log(`   query returned ${staleResults.length} candidate(s)`)
    console.log(
      !foundStale
        ? `✅ PASS: 20-min-old order is correctly EXCLUDED — a new order would be created`
        : `❌ FAIL: 20-min-old order was still returned — cutoff is broken!`,
    )
    console.log()

    // ── TEST 3: bump created_at to exactly 14 min ago (edge) ──
    console.log('── STEP 5: Edge case — 14 minutes old should still be INCLUDED ──')
    const fourteenMinAgo = new Date(Date.now() - 14 * 60 * 1000)
    await prisma.order.update({
      where: { id: existing.id },
      data: { createdAt: fourteenMinAgo },
    })
    const edgeResults = await runReuseQuery(existing.userId, existing.guestEmail)
    const foundEdge = edgeResults.some((o) => o.id === existing.id)
    console.log(
      foundEdge
        ? `✅ PASS: 14-min-old order is STILL in the window (correct)`
        : `❌ FAIL: 14-min-old order was excluded — cutoff is too aggressive`,
    )
    console.log()

    // ── TEST 4: exactly 16 min ago — should be out ──
    console.log('── STEP 6: Edge case — 16 minutes old should be EXCLUDED ──')
    const sixteenMinAgo = new Date(Date.now() - 16 * 60 * 1000)
    await prisma.order.update({
      where: { id: existing.id },
      data: { createdAt: sixteenMinAgo },
    })
    const sixteenResults = await runReuseQuery(existing.userId, existing.guestEmail)
    const foundSixteen = sixteenResults.some((o) => o.id === existing.id)
    console.log(
      !foundSixteen
        ? `✅ PASS: 16-min-old order is correctly EXCLUDED`
        : `❌ FAIL: 16-min-old order was still in the window`,
    )
    console.log()
  } finally {
    console.log('── CLEANUP: Restoring original created_at ──')
    await prisma.order.update({
      where: { id: existing.id },
      data: { createdAt: originalCreatedAt },
    })
    console.log(`   restored → ${originalCreatedAt.toISOString()}`)
  }
}

main()
  .catch((e) => {
    console.error('Script error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
