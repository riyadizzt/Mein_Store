/**
 * READ-ONLY integrity check — pre-flight for the inventory CHECK constraints.
 * VALIDATE CONSTRAINT will fail if ANY existing row violates the rule.
 * We need 0 violations for all three constraints.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('\n═══ INVENTORY INTEGRITY AUDIT ═══\n')

  // 1. quantity_on_hand < 0
  const neg1 = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, variant_id, warehouse_id, quantity_on_hand, quantity_reserved
     FROM inventory
     WHERE quantity_on_hand < 0
     LIMIT 20`,
  )
  console.log(`[1] quantity_on_hand < 0 : ${neg1.length === 0 ? '✅ clean' : `🔴 ${neg1.length} rows`}`)
  for (const r of neg1) console.log(`    ${JSON.stringify(r)}`)

  // 2. quantity_reserved < 0
  const neg2 = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, variant_id, warehouse_id, quantity_on_hand, quantity_reserved
     FROM inventory
     WHERE quantity_reserved < 0
     LIMIT 20`,
  )
  console.log(`[2] quantity_reserved < 0 : ${neg2.length === 0 ? '✅ clean' : `🔴 ${neg2.length} rows`}`)
  for (const r of neg2) console.log(`    ${JSON.stringify(r)}`)

  // 3. quantity_reserved > quantity_on_hand
  const neg3 = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, variant_id, warehouse_id, quantity_on_hand, quantity_reserved
     FROM inventory
     WHERE quantity_reserved > quantity_on_hand
     LIMIT 20`,
  )
  console.log(`[3] quantity_reserved > quantity_on_hand : ${neg3.length === 0 ? '✅ clean' : `🔴 ${neg3.length} rows`}`)
  for (const r of neg3) console.log(`    ${JSON.stringify(r)}`)

  // Total row count for context
  const total = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::int AS c FROM inventory`)
  console.log(`\nTotal inventory rows: ${total[0].c}`)

  console.log('\n═══ END ═══\n')
  await prisma.$disconnect()

  const bad = neg1.length + neg2.length + neg3.length
  if (bad > 0) process.exit(1)
}

main().catch((e) => {
  console.error('Fatal:', e)
  prisma.$disconnect()
  process.exit(1)
})
