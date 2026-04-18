/**
 * READ-ONLY deep scan: look for ANY trace of return-restocks in the DB.
 * If Return table is empty, check for orphan movements, audit logs, etc.
 */

try {
  const fs = require('node:fs')
  const path = require('node:path')
  const envText = fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8')
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(m[1] in process.env)) process.env[m[1]] = v
  }
} catch {}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require('@prisma/client')
const prisma: any = new PrismaClient()

async function main() {
  console.log('\n═══ DEEP SCAN — Return/Restock Trace ═══\n')

  // 1. Raw return-table count (no filter)
  const retCount = await prisma.return.count()
  console.log(`  returns: total rows = ${retCount}`)

  // 2. Any InventoryMovement with return_received type?
  const allReturnReceived = await prisma.inventoryMovement.count({
    where: { type: 'return_received' },
  })
  console.log(`  inventory_movements WHERE type='return_received': ${allReturnReceived}`)

  // 3. Any movement with notes containing 'return', 'scan', 'restock'?
  const notesReturn = await prisma.inventoryMovement.count({
    where: { notes: { contains: 'Return', mode: 'insensitive' } },
  })
  console.log(`  inventory_movements WHERE notes contains "Return": ${notesReturn}`)

  // 4. List all distinct movement types to see what's been used
  const types = await prisma.inventoryMovement.groupBy({
    by: ['type'],
    _count: { _all: true },
  })
  console.log('\n  All movement types in history:')
  for (const t of types) {
    console.log(`    ${t.type.padEnd(25)} ${t._count._all}`)
  }

  // 5. Audit log for return-related actions
  const auditReturn = await prisma.auditLog.count({
    where: { action: { startsWith: 'RETURN' } },
  })
  console.log(`\n  audit_logs WHERE action LIKE 'RETURN_%': ${auditReturn}`)

  const auditReturnTypes = await prisma.auditLog.groupBy({
    by: ['action'],
    where: { action: { startsWith: 'RETURN' } },
    _count: { _all: true },
  })
  if (auditReturnTypes.length > 0) {
    console.log('  Return-related audit actions:')
    for (const a of auditReturnTypes) {
      console.log(`    ${a.action.padEnd(30)} ${a._count._all}`)
    }
  }

  // 6. Orders with status='returned'
  const ordersReturned = await prisma.order.count({
    where: { status: 'returned' },
  })
  console.log(`\n  orders WHERE status='returned': ${ordersReturned}`)

  // 7. Soft-deleted returns? Not a field in schema — but confirm
  const sampleRet = await prisma.return.findFirst({})
  console.log(`\n  Any return row at all (findFirst)? ${sampleRet ? 'YES' : 'NO'}`)

  // 8. Credit Notes (Gutschriften) from refunds
  const creditNotes = await prisma.creditNote.count()
  console.log(`  credit_notes total: ${creditNotes}`)

  // 9. Recent order activity
  const recentOrders = await prisma.order.findMany({
    select: { id: true, orderNumber: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })
  console.log('\n  10 most recent orders:')
  for (const o of recentOrders) {
    console.log(`    ${o.orderNumber}  ${o.status.padEnd(12)}  ${o.createdAt.toISOString()}`)
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
