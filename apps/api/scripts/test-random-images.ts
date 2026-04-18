import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const imgs = await prisma.productImage.findMany({
    where: { product: { deletedAt: null, isActive: true } },
    select: { url: true, product: { select: { slug: true } } },
    take: 6,
    orderBy: { createdAt: 'desc' },
  })
  for (const i of imgs) {
    const r = await fetch(i.url, { method: 'HEAD' }).catch(e => ({ status: 'ERR' } as any))
    console.log(`  ${r.status}  ${i.product.slug.padEnd(20)}  ${i.url.split('/').pop()?.slice(0, 50)}`)
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
