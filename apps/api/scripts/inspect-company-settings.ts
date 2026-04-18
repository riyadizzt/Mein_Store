import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const companyKeys = [
    'companyName', 'companyAddress', 'companyVatId',
    'companyCeo', 'companyPhone', 'companyEmail', 'companyRegister',
  ]

  console.log('\n═══ Firmendaten in shop_settings ═══\n')
  for (const k of companyKeys) {
    const r = await prisma.shopSetting.findUnique({ where: { key: k } })
    const val = r?.value ?? '(not in DB)'
    console.log(`  ${k.padEnd(22)} = "${val}"`)
  }

  console.log('\n═══ Audit-Log: Settings-Updates der letzten 7 Tage, die Firmendaten-Keys enthielten ═══\n')
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const audits = await prisma.adminAuditLog.findMany({
    where: { action: 'SETTINGS_UPDATED', createdAt: { gte: weekAgo } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  let sawCompanySave = false
  for (const a of audits) {
    const c = a.changes as any
    const after = c?.after ?? {}
    const companyFieldsInThisSave = companyKeys.filter((k) => k in after)
    if (companyFieldsInThisSave.length === 0) continue
    sawCompanySave = true
    console.log(`  ${a.createdAt.toISOString().slice(0, 19)}  by=${a.adminId}`)
    for (const k of companyFieldsInThisSave) {
      const v = after[k]
      const shown = String(v === '' ? '(leer)' : v).slice(0, 50)
      console.log(`      ${k.padEnd(22)} = "${shown}"`)
    }
    console.log('')
  }
  if (!sawCompanySave) console.log('  Keine Firmendaten-Saves in den letzten 7 Tagen.')

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
