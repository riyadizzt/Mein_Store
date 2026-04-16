import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const settings = await prisma.shopSetting.findMany({ where: { key: { startsWith: 'ai_' } } })
  console.log('AI Settings:')
  for (const s of settings) console.log(`  ${s.key} = ${s.value}`)
  if (settings.length === 0) console.log('  (none set — AI features use defaults)')
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
