/**
 * Delete the dead product_image row for product "fh" (b4f2ee5d).
 * The Supabase storage file returns 404 — the DB row is orphaned.
 * Test data cleanup.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const PRODUCT_ID = 'b4f2ee5d-218b-4c44-b51e-632077d5cd0f'
  const EXPECTED_URL_FRAGMENT = 'Bildschirmfoto_2026-03-29_um_12.14.41_1774791437456.webp'

  const images = await prisma.productImage.findMany({
    where: { productId: PRODUCT_ID },
  })

  console.log(`\n── BEFORE ──\n`)
  console.log(`  Product ${PRODUCT_ID.slice(0, 8)} has ${images.length} image row(s):`)
  for (const img of images) {
    console.log(`    ${img.id.slice(0, 8)}  sortOrder=${img.sortOrder}  primary=${img.isPrimary}`)
    console.log(`      ${img.url}`)
  }

  const dead = images.filter((i) => i.url.includes(EXPECTED_URL_FRAGMENT))
  if (dead.length === 0) {
    console.log('\n⚠  No image row matches the expected broken URL — refusing to delete anything.')
    await prisma.$disconnect()
    return
  }
  if (dead.length > 1) {
    console.log(`\n⚠  Multiple rows (${dead.length}) match — refusing to delete to be safe.`)
    await prisma.$disconnect()
    return
  }

  const target = dead[0]
  console.log(`\n── Deleting row ${target.id.slice(0, 8)} ──\n`)

  await prisma.productImage.delete({ where: { id: target.id } })

  const after = await prisma.productImage.findMany({ where: { productId: PRODUCT_ID } })
  console.log(`── AFTER ──\n`)
  console.log(`  Product now has ${after.length} image row(s)`)
  for (const img of after) {
    console.log(`    ${img.id.slice(0, 8)}  primary=${img.isPrimary}  ${img.url}`)
  }

  console.log('\n✅ Done.')
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
