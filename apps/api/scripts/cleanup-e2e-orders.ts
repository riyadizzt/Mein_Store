/**
 * Cleanup leftover e2e test orders + their products. Runs after a
 * failed teardown of test-reservation-lifecycle-e2e.ts that couldn't
 * delete orders because of the invoices FK.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  // Find all orders whose items reference a variant from an e2e-lifecycle product
  const e2eProducts = await prisma.product.findMany({
    where: { slug: { startsWith: 'e2e-lifecycle-' } },
    select: { id: true, slug: true, variants: { select: { id: true } } },
  })
  console.log(`Found ${e2eProducts.length} e2e-lifecycle test product(s)`)

  const variantIds = e2eProducts.flatMap((p) => p.variants.map((v) => v.id))
  if (variantIds.length === 0) { console.log('nothing to clean'); await prisma.$disconnect(); return }

  const orders = await prisma.order.findMany({
    where: { items: { some: { variantId: { in: variantIds } } } },
    select: { id: true, orderNumber: true },
  })
  console.log(`Found ${orders.length} test order(s) linked to e2e variants`)

  // Delete order → in correct FK order
  for (const o of orders) {
    try {
      await prisma.invoice.deleteMany({ where: { orderId: o.id } })
      await prisma.payment.deleteMany({ where: { orderId: o.id } })
      await prisma.stockReservation.deleteMany({ where: { orderId: o.id } })
      await prisma.inventoryMovement.deleteMany({ where: { referenceId: o.id } })
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: o.id } })
      await prisma.orderItem.deleteMany({ where: { orderId: o.id } })
      await prisma.order.delete({ where: { id: o.id } })
      console.log(`  ✓ deleted ${o.orderNumber}`)
    } catch (e: any) {
      console.error(`  ✗ ${o.orderNumber}: ${e.message}`)
    }
  }

  // Then delete the products (cascades variants + inventory)
  for (const p of e2eProducts) {
    try {
      await prisma.inventoryMovement.deleteMany({ where: { variantId: { in: p.variants.map((v) => v.id) } } })
      await prisma.stockReservation.deleteMany({ where: { variantId: { in: p.variants.map((v) => v.id) } } })
      await prisma.product.delete({ where: { id: p.id } })
      console.log(`  ✓ deleted product ${p.slug}`)
    } catch (e: any) {
      console.error(`  ✗ product ${p.slug}: ${e.message}`)
    }
  }

  await prisma.$disconnect()
  console.log('\n✅ cleanup complete')
}
main().catch((e) => { console.error(e); process.exit(1) })
