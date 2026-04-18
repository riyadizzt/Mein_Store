import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

// Copy of COLOR_MAP keys from locale-utils.ts
const TRANSLATED = new Set([
  'Schwarz','Weiß','Blau','Rot','Grün','Grau','Beige','Navy','Braun','Rosa','Gelb','Orange','Lila','Türkis','Bordeaux','Khaki','Silber','Gold',
  'Black','White','Blue','Red','Green','Gray','Brown','Pink','Yellow','Purple',
])

async function main() {
  const rows = await prisma.productVariant.groupBy({
    by: ['color'],
    where: { isActive: true, color: { not: null }, product: { deletedAt: null } },
    _count: true,
    orderBy: { _count: { color: 'desc' } },
  })
  console.log(`\n  All distinct colors in active variants (${rows.length} distinct):\n`)
  for (const r of rows) {
    const marker = TRANSLATED.has(r.color!) ? '✓' : '✗ untranslated'
    console.log(`    ${marker.padEnd(18)}  ${r.color!.padEnd(22)}  ${r._count} variants`)
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
