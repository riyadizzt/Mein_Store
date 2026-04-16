import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const start = new Date('2026-04-01T00:00:00.000Z')
  const end = new Date('2026-04-16T23:59:59.999Z')

  const orders = await prisma.order.aggregate({
    where: {
      createdAt: { gte: start, lte: end },
      channel: { in: ['website', 'mobile'] },
      status: { in: ['confirmed', 'processing', 'shipped', 'delivered', 'returned'] },
      deletedAt: null,
    },
    _sum: { totalAmount: true, taxAmount: true },
    _count: true,
  })
  console.log('Orders in range:', orders._count)
  console.log('Total gross:', Number(orders._sum.totalAmount ?? 0).toFixed(2))
  console.log('Total tax:', Number(orders._sum.taxAmount ?? 0).toFixed(2))

  // Check the raw SQL that the VAT report uses
  const vatRows = await prisma.$queryRaw<any[]>`
    SELECT
      oi.tax_rate,
      COALESCE(SUM(CAST(oi.total_price AS DECIMAL(10,2))), 0) AS gross_amount,
      COUNT(*) as row_count
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.created_at >= ${start}
      AND o.created_at <= ${end}
      AND o.channel IN ('website', 'mobile', 'facebook', 'instagram', 'tiktok', 'google', 'whatsapp')
      AND o.status IN ('confirmed', 'processing', 'shipped', 'delivered', 'returned')
      AND o.deleted_at IS NULL
    GROUP BY oi.tax_rate
    ORDER BY oi.tax_rate DESC
  `
  console.log('\nVAT SQL result:')
  for (const r of vatRows) {
    console.log(`  rate=${r.tax_rate}  gross=${Number(r.gross_amount).toFixed(2)}  rows=${r.row_count}`)
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
