/**
 * Pull ONE real rendered email layout from the running service and inspect
 * the footer. Verifies that social URLs from DB flow through properly.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NestFactory } = require('@nestjs/core')
const distBase = '../dist/apps/api/src'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require(`${distBase}/app.module`)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { EmailService } = require(`${distBase}/modules/email/email.service`)

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] })
  const email = app.get(EmailService)

  // Use the private getCompanyData() to show what context is built
  const companyData = (email as any).getCompanyData()
  console.log('\n═══ Handlebars Context (getCompanyData) ═══\n')
  for (const [k, v] of Object.entries(companyData)) {
    if (['instagramUrl', 'facebookUrl', 'tiktokUrl', 'hasSocial'].includes(k)) {
      console.log(`  ${k.padEnd(18)} = "${v}"`)
    }
  }

  // Render the DE layout using the PRIVATE cached template
  const layout = (email as any).layoutDe
  const html = layout({
    ...companyData,
    subject: 'Test',
    content: '<p>Hello</p>',
  })

  const keyChecks: Array<[string, boolean]> = [
    ['Instagram link present', html.includes('https://www.instagram.com/bekleidung_malak/')],
    ['Facebook link present', html.includes('https://www.facebook.com/MalakBekleidung')],
    ['TikTok link present', html.includes('https://www.tiktok.com/@malak_bekleidung')],
    ['Old hardcoded instagram.com/malak.bekleidung NOT present', !html.includes('instagram.com/malak.bekleidung')],
    ['Klarna pink #FFA8CD', html.includes('background:#FFA8CD')],
    ['SumUp black #0f0f0f', html.includes('background:#0f0f0f')],
    ['Visa PNG', html.includes('icons8.com/color/32/visa.png')],
    ['Social row rendered (hasSocial truthy)', html.includes('icons8.com/ios-filled/18/ffffff/instagram-new.png')],
  ]
  console.log('\n═══ Rendered DE Layout Footer Checks ═══\n')
  let pass = 0; let fail = 0
  for (const [label, ok] of keyChecks) {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`)
    if (ok) pass++; else fail++
  }
  console.log(`\n  ${pass} pass / ${fail} fail\n`)

  await app.close()
  process.exit(fail === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(1) })
