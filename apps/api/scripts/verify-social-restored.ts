import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const keys = ['tiktokUrl','facebookUrl','instagramUrl']
  for (const k of keys) {
    const r = await prisma.shopSetting.findUnique({ where: { key: k } })
    console.log(`  ${k}: "${r?.value ?? '(null)'}"`)
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
