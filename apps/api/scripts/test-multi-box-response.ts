import { PrismaClient } from '@prisma/client'
import { AdminInventoryService } from '../src/modules/admin/services/admin-inventory.service'

const prisma = new PrismaClient()
const service = new AdminInventoryService(prisma as any, { log: async () => {} } as any)

async function main() {
  // Search for the multi-box variant
  const result = await service.findAllGrouped({ search: 'MAL-000110-DGR-M' })
  if (result.data.length === 0) { console.log('Not found'); await prisma.$disconnect(); return }

  const product = result.data[0] as any
  console.log(`Product: ${product.productId.slice(0, 8)}  variants: ${product.variants.length}`)

  for (const v of product.variants) {
    const boxes = (v as any).boxes ?? []
    console.log(`  ${v.sku}  stock=${v.stock}  boxes=${boxes.length > 0 ? boxes.map((b: any) => `${b.boxNumber}(${b.qty})`).join(', ') : 'none'}`)
  }

  // Also check the 4-item box variant
  const result2 = await service.findAllGrouped({ search: 'MAL-000046-DUN-L' })
  if (result2.data.length > 0) {
    const p2 = result2.data[0] as any
    for (const v of p2.variants) {
      const boxes = (v as any).boxes ?? []
      if (v.sku === 'MAL-000046-DUN-L') {
        console.log(`  ${v.sku}  stock=${v.stock}  boxes=${boxes.map((b: any) => `${b.boxNumber}(${b.qty})`).join(', ') || 'none'}`)
      }
    }
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
