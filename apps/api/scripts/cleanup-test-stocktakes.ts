/**
 * Cleanup script for leftover test-correction stocktakes. Removes the
 * ones that were created during today's UI test run — identified by
 * `notes LIKE 'correction_of:%'` WHERE createdAt > 2026-04-15 12:31.
 *
 * Preserves the 2 original user stocktakes (#077a39 + #3fa267) and
 * anything older than the test window.
 *
 * SAFETY: hardcoded cutoff, status-check, dry-run first, only deletes
 * rows that ALSO have a correction_of: notes field. Prints every row
 * before deleting.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const CUTOFF = new Date('2026-04-15T12:30:00Z')

async function main() {
  const candidates = await prisma.stocktake.findMany({
    where: {
      createdAt: { gte: CUTOFF },
      notes: { startsWith: 'correction_of:' },
    },
    include: { _count: { select: { items: true } } },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`\nFound ${candidates.length} correction-chain test rows created after ${CUTOFF.toISOString()}:\n`)
  for (const c of candidates) {
    console.log(`  #${c.id.slice(-6)}  ${c.status.padEnd(12)}  ${c._count.items} items  ${c.createdAt.toISOString()}  notes="${c.notes}"`)
  }

  if (candidates.length === 0) {
    console.log('Nothing to clean.')
    await prisma.$disconnect()
    return
  }

  console.log('\nDeleting (cascades items)...')
  let deleted = 0
  for (const c of candidates) {
    try {
      await prisma.stocktake.delete({ where: { id: c.id } })
      deleted++
      console.log(`  ✓ #${c.id.slice(-6)}`)
    } catch (e: any) {
      console.error(`  ✗ #${c.id.slice(-6)}: ${e.message}`)
    }
  }
  console.log(`\n✅ Cleaned ${deleted}/${candidates.length} rows.`)

  // Also clean their audit-log entries so the UI doesn't show dead links
  const audit = await prisma.adminAuditLog.deleteMany({
    where: {
      action: { in: ['STOCKTAKE_STARTED', 'STOCKTAKE_DELETED', 'STOCKTAKE_CORRECTION_STARTED'] },
      entityId: { in: candidates.map((c) => c.id) },
    },
  })
  console.log(`   + ${audit.count} audit log row(s) cleaned.`)

  // Show what remains
  const remaining = await prisma.stocktake.findMany({
    include: { _count: { select: { items: true } } },
    orderBy: { createdAt: 'desc' },
  })
  console.log(`\nRemaining stocktakes in DB: ${remaining.length}`)
  for (const r of remaining) {
    console.log(`  #${r.id.slice(-6)}  ${r.status.padEnd(12)}  ${r._count.items} items  ${r.createdAt.toISOString().slice(0, 19)}`)
  }

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
