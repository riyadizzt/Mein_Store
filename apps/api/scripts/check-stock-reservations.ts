/**
 * Read-only: shows current inventory + stock reservations for specific SKUs.
 * Used to answer "are these 2 products still reserved".
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const SKUS = ['MAL-GHHS-SCH-XS', 'MAL-000095-GRA-S']

async function main() {
  for (const sku of SKUS) {
    console.log(`\n── SKU ${sku} ─────────────────────────────────\n`)
    const variant = await prisma.productVariant.findFirst({
      where: { sku },
      select: {
        id: true, sku: true, color: true, size: true,
        product: { select: { id: true, deletedAt: true, translations: { where: { language: 'de' }, select: { name: true } } } },
        inventory: {
          select: {
            id: true, quantityOnHand: true, quantityReserved: true,
            warehouse: { select: { name: true, type: true } },
          },
        },
      },
    })
    if (!variant) { console.log('   variant not found'); continue }

    const name = variant.product.translations[0]?.name ?? '(no DE name)'
    const status = variant.product.deletedAt ? `DELETED ${variant.product.deletedAt.toISOString().slice(0, 10)}` : 'active'
    console.log(`   Product: "${name}" [${status}]`)
    console.log(`   Variant: ${variant.color}/${variant.size}  id=${variant.id}`)

    if (variant.inventory.length === 0) {
      console.log('   → NO inventory rows')
    } else {
      for (const inv of variant.inventory) {
        const avail = inv.quantityOnHand - inv.quantityReserved
        console.log(`   ${inv.warehouse.name.padEnd(22)} onHand=${inv.quantityOnHand.toString().padStart(3)}  reserved=${inv.quantityReserved.toString().padStart(3)}  available=${avail.toString().padStart(3)}`)
      }
    }

    // Active reservations for this variant (any warehouse)
    const reservations = await prisma.stockReservation.findMany({
      where: {
        variantId: variant.id,
        status: 'RESERVED',
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true, quantity: true, expiresAt: true, orderId: true, sessionId: true,
        warehouse: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (reservations.length === 0) {
      console.log('   No active reservations.')
    } else {
      console.log(`   ${reservations.length} active reservation(s):`)
      for (const r of reservations) {
        const minutesLeft = Math.round((r.expiresAt.getTime() - Date.now()) / 60000)
        const source = r.orderId ? `order=${r.orderId.slice(0, 8)}` : `session=${r.sessionId?.slice(0, 8)}`
        console.log(`     qty=${r.quantity}  ${r.warehouse.name}  expires_in=${minutesLeft}min  ${source}`)
      }
    }
  }

  // Also check for any EXPIRED-but-not-released reservations that may be leaking stock
  console.log('\n── Expired-not-released reservations (system-wide) ──\n')
  const leaking = await prisma.stockReservation.count({
    where: { status: 'RESERVED', expiresAt: { lt: new Date() } },
  })
  if (leaking > 0) {
    console.log(`   ⚠ ${leaking} reservation(s) are EXPIRED but still marked RESERVED`)
    console.log(`     → these will be swept by the reservation cleanup cron`)
  } else {
    console.log('   ✓ No leaking reservations.')
  }

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
