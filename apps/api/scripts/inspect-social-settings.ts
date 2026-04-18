import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  // Alle Keys mit "social", "facebook", "instagram", "tiktok" im Namen
  const keys = ['social_instagram', 'social_facebook', 'social_tiktok',
    'instagram_url', 'facebook_url', 'tiktok_url',
    'instagramUrl', 'facebookUrl', 'tiktokUrl']

  console.log('\n═══ Settings Keys (erwartet) ═══\n')
  const rows = await prisma.shopSetting.findMany({
    where: {
      OR: [
        { key: { contains: 'social' } },
        { key: { contains: 'instagram' } },
        { key: { contains: 'facebook' } },
        { key: { contains: 'tiktok' } },
      ],
    },
    orderBy: { key: 'asc' },
  })
  for (const r of rows) {
    console.log(`  ${r.key.padEnd(32)} = "${String(r.value).slice(0, 80)}"`)
  }
  if (rows.length === 0) console.log('  KEINE Social-Keys in shop_settings.')

  console.log('\n═══ Letzte SETTINGS_UPDATED Audit-Logs (heute) ═══\n')
  const today = new Date(); today.setHours(0,0,0,0)
  const audits = await prisma.adminAuditLog.findMany({
    where: { action: 'SETTINGS_UPDATED', createdAt: { gte: today } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { createdAt: true, adminId: true, changes: true },
  })
  for (const a of audits) {
    const c = a.changes as any
    const after = c?.after ? Object.keys(c.after) : []
    const hasSocial = after.some((k: string) => /social|facebook|instagram|tiktok/i.test(k))
    const marker = hasSocial ? ' ⬅ SOCIAL' : ''
    console.log(`  ${a.createdAt.toISOString().slice(0,19)}  by=${a.adminId}  keys=[${after.slice(0,8).join(', ')}${after.length>8?'…':''}]${marker}`)
    if (hasSocial) {
      const socialKeys = after.filter((k: string) => /social|facebook|instagram|tiktok/i.test(k))
      for (const k of socialKeys) {
        console.log(`      ${k} = "${String(c.after[k]).slice(0, 80)}"`)
      }
    }
  }
  if (audits.length === 0) console.log('  Keine SETTINGS_UPDATED heute.')

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
