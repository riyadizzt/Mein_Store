/**
 * Snapshot der stock-Semantik für bekannte Test-Varianten.
 * Vor und nach dem products.service.ts Change ausführen → diff.
 *
 * VORHER: stock = sum(onHand - reserved) über alle Warehouses
 * NACHHER: stock = max(onHand - reserved) pro Warehouse
 *
 * Nur Read-only, keine DB-Writes. Safe zu jeder Zeit.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const TEST_SKUS = [
  'MAL-046-GRÜ-S', // split: 2 + 0 + 1 → alt 3, neu 2
  'MAL-046-BEI-M', // split: 36 + 12 + 1 → alt 49, neu 36
  'MAL-RTRTR-SCH-XS', // single: 43 → unverändert
  'MAL-RTRTR-GRÜ-XS', // single tiny: 1 → unverändert
  'MAL-046-ROT-L', // single: 21 → unverändert
]

function sum(inv: { quantityOnHand: number; quantityReserved: number }[]): number {
  return inv.reduce((s, i) => s + (i.quantityOnHand - i.quantityReserved), 0)
}

function maxPerWh(inv: { quantityOnHand: number; quantityReserved: number }[]): number {
  return inv.reduce((m, i) => Math.max(m, i.quantityOnHand - i.quantityReserved), 0)
}

async function main() {
  console.log(`\n═══ Stock Semantics Snapshot ═══\n`)
  for (const sku of TEST_SKUS) {
    const v = await prisma.productVariant.findFirst({
      where: { sku },
      include: {
        inventory: {
          select: {
            quantityOnHand: true,
            quantityReserved: true,
            warehouse: { select: { name: true } },
          },
        },
      },
    })
    if (!v) {
      console.log(`  ${sku}: NOT FOUND`)
      continue
    }
    const perWh = v.inventory.map((i) => ({
      wh: i.warehouse.name,
      avail: i.quantityOnHand - i.quantityReserved,
    }))
    const oldStock = sum(v.inventory)
    const newStock = maxPerWh(v.inventory)
    const diff = oldStock !== newStock ? `  ← CHANGES (${oldStock}→${newStock})` : ''
    console.log(`\n  ${sku}${diff}`)
    console.log(`    per-warehouse: ${JSON.stringify(perWh)}`)
    console.log(`    alt (sum):  ${oldStock}`)
    console.log(`    neu (max):  ${newStock}`)
  }
  console.log('\n')
  await prisma.$disconnect()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
