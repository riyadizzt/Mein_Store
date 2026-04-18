import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const imgs = await prisma.productImage.findMany({
    where: { productId: '649d31f4-7e7e-4863-bd51-179d8b9fb1bc' },
    select: { id: true, url: true, isPrimary: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' },
  })
  console.log(`\n  rtrtr Product: ${imgs.length} images in DB\n`)
  for (const i of imgs) {
    const f = i.url.split('/').pop()
    console.log(`  ${i.isPrimary?'●':'○'} ${f}`)
  }
  // Test ALL URLs
  console.log('\n  HTTP test (HEAD):')
  for (const i of imgs) {
    const res = await fetch(i.url, { method: 'HEAD' }).catch(e => ({ status: 'ERR', statusText: e.message } as any))
    console.log(`    ${res.status}  ${i.url.split('/').pop()}`)
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
