/**
 * Read-only PREVIEW first. Restores tiktokUrl/facebookUrl/instagramUrl from
 * the 09:54 audit-log snapshot. Writes ONLY if --apply passed.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const URLS = {
  tiktokUrl: 'https://www.tiktok.com/@malak_bekleidung',
  facebookUrl: 'https://www.facebook.com/MalakBekleidung',
  instagramUrl: 'https://www.instagram.com/bekleidung_malak/',
}

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(`\n═══ ${apply ? 'APPLY' : 'PREVIEW (no writes)'} ═══\n`)

  for (const [key, url] of Object.entries(URLS)) {
    const current = await prisma.shopSetting.findUnique({ where: { key } })
    const currentVal = current?.value ?? '(null)'
    console.log(`  ${key}`)
    console.log(`    ist:  "${currentVal}"`)
    console.log(`    soll: "${url}"`)
    if (apply) {
      await prisma.shopSetting.upsert({
        where: { key },
        update: { value: url },
        create: { key, value: url },
      })
      console.log(`    ✓ written`)
    }
    console.log('')
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
