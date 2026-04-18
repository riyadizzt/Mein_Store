import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  // Finde die Variante
  const variant = await prisma.productVariant.findFirst({
    where: { sku: 'MAL-RTRTR-SCH-XS' },
    select: { id: true, sku: true, color: true, size: true },
  })
  if (!variant) { console.log('NOT FOUND'); return }
  console.log(`\n  Variant: ${variant.sku} (${variant.color}/${variant.size})  id=${variant.id.slice(0, 8)}\n`)

  // Inventory-Zähler pro Warehouse
  console.log('  ═══ inventory rows (what the admin UI reads) ═══')
  const inv = await prisma.inventory.findMany({
    where: { variantId: variant.id },
    include: { warehouse: { select: { name: true } } },
  })
  for (const i of inv) {
    const avail = i.quantityOnHand - i.quantityReserved
    console.log(`    ${i.warehouse.name.padEnd(20)}  onHand=${i.quantityOnHand}  reserved=${i.quantityReserved}  → available=${avail}`)
  }

  // Aktive Reservierungen (Ground-Truth aus stock_reservations Tabelle)
  console.log('\n  ═══ stock_reservations (WIRKLICHE aktive Reservierungen) ═══')
  const reservations = await prisma.stockReservation.findMany({
    where: { variantId: variant.id, status: 'RESERVED' },
    include: { warehouse: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  })
  if (reservations.length === 0) {
    console.log('    KEINE aktiven Reservierungen')
  } else {
    for (const r of reservations) {
      const ago = Math.round((Date.now() - r.createdAt.getTime()) / 60000)
      console.log(`    ${r.warehouse.name.padEnd(20)}  qty=${r.quantity}  order=${r.orderId?.slice(0, 8) ?? '(none)'}  createdAt=${r.createdAt.toISOString().slice(0,16)}  (${ago} min)  expires=${r.expiresAt?.toISOString().slice(0,16) ?? 'null'}`)
    }
  }

  // Summe nach Warehouse
  const sumPerWh = new Map<string, number>()
  for (const r of reservations) {
    const w = r.warehouse.name
    sumPerWh.set(w, (sumPerWh.get(w) ?? 0) + r.quantity)
  }

  console.log('\n  ═══ DRIFT-ANALYSE ═══')
  for (const i of inv) {
    const real = sumPerWh.get(i.warehouse.name) ?? 0
    const counter = i.quantityReserved
    const diff = counter - real
    const marker = diff === 0 ? '✓ konsistent' : `⚠ DRIFT: counter=${counter}, real=${real}, diff=${diff}`
    console.log(`    ${i.warehouse.name.padEnd(20)}  ${marker}`)
  }

  // Letzte Movements
  console.log('\n  ═══ letzte 10 Movements ═══')
  const movements = await prisma.inventoryMovement.findMany({
    where: { variantId: variant.id },
    include: { warehouse: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })
  for (const m of movements) {
    console.log(`    ${m.createdAt.toISOString().slice(11, 19)}  ${(m.type ?? '').padEnd(18)}  qty=${m.quantity.toString().padStart(4)}  ${(m.warehouse?.name ?? '—').padEnd(18)}  "${(m.notes ?? '').slice(0, 80)}"`)
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
