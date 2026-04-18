import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  // Find the 15:46 audit log exactly
  const a = await prisma.adminAuditLog.findFirst({
    where: {
      action: 'SETTINGS_UPDATED',
      createdAt: { gte: new Date('2026-04-17T15:46:00Z'), lte: new Date('2026-04-17T15:47:00Z') },
    },
  })
  if (!a) { console.log('Not found'); return }
  const c = a.changes as any
  console.log(`\n═══ 15:46 SETTINGS_UPDATED — ALLE ${Object.keys(c?.after ?? {}).length} Keys ═══\n`)
  const keys = Object.keys(c?.after ?? {}).sort()
  for (const k of keys) {
    const v = c.after[k]
    const shown = v === '' ? '(leer)' : typeof v === 'string' ? v.slice(0, 40) : String(v)
    const isCompany = /^company/.test(k)
    console.log(`  ${isCompany ? '⚠' : ' '} ${k.padEnd(32)} = ${shown === '(leer)' ? '(leer)' : `"${shown}"`}`)
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
