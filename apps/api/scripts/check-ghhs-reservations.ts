import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  // Find variant MAL-GHHS-SCH-XS
  const variant = await prisma.productVariant.findFirst({
    where: { sku: 'MAL-GHHS-SCH-XS' },
    select: { id: true, sku: true },
  })
  if (!variant) { console.log('Variant not found'); return }

  console.log(`\nVariant: ${variant.sku}  (${variant.id})\n`)

  // Inventory row in Marzahn
  const inv = await prisma.inventory.findMany({
    where: { variantId: variant.id },
    include: { warehouse: { select: { name: true } } },
  })
  console.log('── Inventory rows ──')
  for (const i of inv) {
    const avail = i.quantityOnHand - i.quantityReserved
    console.log(`  ${i.warehouse.name.padEnd(20)}  onHand=${i.quantityOnHand}  reserved=${i.quantityReserved}  available=${avail}`)
  }

  // Actual reservations in DB for this variant, grouped by status
  console.log('\n── Actual reservations (grouped by status) ──')
  const byStatus = await prisma.stockReservation.groupBy({
    by: ['status'],
    where: { variantId: variant.id },
    _count: { _all: true },
    _sum: { quantity: true },
  })
  for (const g of byStatus) {
    console.log(`  ${g.status.padEnd(12)}  rows=${g._count._all}  sumQty=${g._sum.quantity}`)
  }

  // Just active RESERVED
  const active = await prisma.stockReservation.findMany({
    where: { variantId: variant.id, status: 'RESERVED' },
    select: { id: true, quantity: true, orderId: true, expiresAt: true },
  })
  console.log(`\n── Active RESERVED rows for this variant: ${active.length} ──`)
  for (const r of active) {
    console.log(`  ${r.id.slice(0, 8)}  ${r.quantity}x  order=${r.orderId?.slice(0,8) ?? 'null'}  expires=${r.expiresAt.toISOString()}`)
  }

  // Compare
  const reservedCounter = inv[0]?.quantityReserved ?? 0
  const actualActiveSum = active.reduce((s, r) => s + r.quantity, 0)
  console.log(`\n── Drift check ──`)
  console.log(`  inventory.quantityReserved counter: ${reservedCounter}`)
  console.log(`  actual sum of RESERVED rows:        ${actualActiveSum}`)
  if (reservedCounter !== actualActiveSum) {
    console.log(`  ⚠  DRIFT: counter is ${reservedCounter - actualActiveSum} too high (phantom/historical)`)
  } else {
    console.log(`  ✅ counter matches actual reservations`)
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
