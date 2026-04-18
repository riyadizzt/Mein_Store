import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  // Check the sequences
  console.log('\n═══ Sequences current state ═══')
  const invSeqs = await prisma.invoiceSequence.findMany()
  console.log(`  invoice_sequences: ${JSON.stringify(invSeqs)}`)
  const orderSeqs = await prisma.orderSequence.findMany()
  console.log(`  order_sequences: ${JSON.stringify(orderSeqs)}`)
  const retSeqs = await prisma.returnSequence.findMany()
  console.log(`  return_sequences: ${JSON.stringify(retSeqs)}`)
  const skuSeqs = await prisma.skuSequence.findMany()
  console.log(`  sku_sequences: ${JSON.stringify(skuSeqs)}`)
  const boxSeqs = await prisma.boxSequence.findMany()
  console.log(`  box_sequences: ${JSON.stringify(boxSeqs)}`)

  // IdempotencyKey
  const idemp = await prisma.idempotencyKey.count()
  console.log(`\n  idempotency_keys: ${idemp}`)

  // Session records (cart, etc)
  try { const carts = await (prisma as any).cart?.count?.() ?? 0; console.log(`  carts: ${carts}`) } catch {}

  // Notifications breakdown
  const notifs = await prisma.notification.groupBy({ by: ['channel'], _count: true })
  console.log(`\n  Notifications by channel: ${JSON.stringify(notifs)}`)

  // Products without images — which ones
  const badProds = await prisma.product.findMany({
    where: { images: { none: {} }, deletedAt: null, isActive: true },
    select: { id: true, slug: true },
    take: 10,
  })
  console.log(`\n  Active products without images (sample): ${badProds.length}`)
  for (const p of badProds) console.log(`    ${p.slug}`)

  // Default warehouse
  const defaultWh = await prisma.warehouse.findFirst({ where: { isDefault: true } })
  console.log(`\n  Default warehouse: ${defaultWh?.name ?? '(none)'}  id=${defaultWh?.id?.slice(0,8) ?? ''}`)

  // Active variants count + inventory rows for them
  const activeVariants = await prisma.productVariant.count({ where: { isActive: true, product: { deletedAt: null } } })
  console.log(`\n  Active variants (not soft-deleted): ${activeVariants}`)

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
