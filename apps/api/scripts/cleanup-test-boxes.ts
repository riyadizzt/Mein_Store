import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  console.log('\n═══ Cleaning up test Master-Boxes ═══\n')

  // Snapshot before
  const mBefore = await prisma.boxManifest.count()
  const iBefore = await prisma.boxItem.count()
  const sBefore = await prisma.boxSequence.findMany()
  console.log(`  Before:  ${mBefore} manifests, ${iBefore} items, ${sBefore.length} sequences`)
  for (const s of sBefore) console.log(`    seq: ${s.yearSeasonKey} = ${s.seq}`)

  // Atomically delete — box_items first (no FK but order is clean), then manifests, then sequences
  await prisma.$transaction([
    prisma.boxItem.deleteMany({}),
    prisma.boxManifest.deleteMany({}),
    prisma.boxSequence.deleteMany({}),
  ])

  // Verify
  const mAfter = await prisma.boxManifest.count()
  const iAfter = await prisma.boxItem.count()
  const sAfter = await prisma.boxSequence.count()
  console.log(`\n  After:   ${mAfter} manifests, ${iAfter} items, ${sAfter} sequences`)

  if (mAfter === 0 && iAfter === 0 && sAfter === 0) {
    console.log('\n  ✅ All Master-Box data cleared. Next box → BOX-2026-W-001\n')
  } else {
    console.log('\n  ✗ cleanup incomplete')
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
