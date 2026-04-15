/**
 * Read-only: investigates why some variants in the CSV have no barcode.
 * Reports the counts, the affected SKUs, and whether they were created
 * via intake (auto-SKU) or via the admin product wizard.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const total = await prisma.productVariant.count({
    where: { product: { deletedAt: null } },
  })
  const withBarcode = await prisma.productVariant.count({
    where: { product: { deletedAt: null }, barcode: { not: null } },
  })
  const nullBarcode = await prisma.productVariant.count({
    where: { product: { deletedAt: null }, barcode: null },
  })
  const emptyBarcode = await prisma.productVariant.count({
    where: { product: { deletedAt: null }, barcode: '' },
  })

  console.log(`\nVariant barcode stats:`)
  console.log(`  Total non-deleted variants: ${total}`)
  console.log(`  With barcode:               ${withBarcode}`)
  console.log(`  Barcode IS NULL:            ${nullBarcode}`)
  console.log(`  Barcode is empty string:    ${emptyBarcode}`)
  console.log(`  Missing overall:            ${nullBarcode + emptyBarcode}\n`)

  // How many have barcode === sku (intake default)?
  const all = await prisma.productVariant.findMany({
    where: { product: { deletedAt: null } },
    select: { id: true, sku: true, barcode: true, createdAt: true, product: { select: { translations: { where: { language: 'de' }, select: { name: true } } } } },
    orderBy: { createdAt: 'asc' },
  })
  const barcodeEqualsSku = all.filter((v) => v.barcode === v.sku).length
  const barcodeDiffersFromSku = all.filter((v) => v.barcode && v.barcode !== v.sku).length
  const noBarcode = all.filter((v) => !v.barcode)

  console.log(`Breakdown:`)
  console.log(`  barcode === sku:      ${barcodeEqualsSku}`)
  console.log(`  barcode !== sku:      ${barcodeDiffersFromSku}`)
  console.log(`  no barcode:           ${noBarcode.length}\n`)

  if (noBarcode.length > 0) {
    console.log(`Variants WITHOUT barcode (sorted by creation date):`)
    for (const v of noBarcode.slice(0, 40)) {
      const name = v.product.translations[0]?.name ?? '(no DE name)'
      console.log(`  ${v.createdAt.toISOString().slice(0, 10)}  ${v.sku.padEnd(25)}  ${name}`)
    }
    if (noBarcode.length > 40) console.log(`  ... and ${noBarcode.length - 40} more`)
  }

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
