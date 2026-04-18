/**
 * Simulate what the /admin/settings GET endpoint returns.
 * Reads directly from DB using same logic as controller.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const rows = await prisma.shopSetting.findMany()
  const db: Record<string, string> = {}
  for (const r of rows) db[r.key] = r.value

  // Mirror exactly what admin.controller.ts:1630 returns for the 6 fields
  const companyFields = {
    companyName: db.companyName ?? process.env.COMPANY_NAME ?? '',
    companyAddress: db.companyAddress ?? process.env.COMPANY_ADDRESS ?? '',
    companyVatId: db.companyVatId ?? process.env.COMPANY_VAT_ID ?? '',
    companyCeo: db.companyCeo ?? process.env.COMPANY_CEO ?? '',
    companyPhone: db.companyPhone ?? process.env.COMPANY_PHONE ?? '',
    companyEmail: db.companyEmail ?? process.env.COMPANY_CONTACT_EMAIL ?? '',
  }

  console.log('\n═══ Was /admin/settings GET zurückgeben würde (company fields) ═══\n')
  for (const [k, v] of Object.entries(companyFields)) {
    console.log(`  ${k.padEnd(20)} = "${v}"`)
  }

  // Also: ALL keys in DB starting with "company"
  const allCompanyKeys = rows.filter(r => r.key.startsWith('company'))
  console.log(`\n═══ Alle DB-Rows mit Prefix 'company' (${allCompanyKeys.length}) ═══\n`)
  for (const r of allCompanyKeys) {
    console.log(`  ${r.key.padEnd(20)} = "${r.value}"`)
  }

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
