import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
;(async () => {
  const cols = await p.$queryRawUnsafe<any[]>(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name='categories'
      AND column_name IN ('ebay_category_id', 'google_category_id')
    ORDER BY column_name`)
  console.log('categories columns:', cols)

  const cnt = await p.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::int AS n FROM categories`)
  console.log('Total categories:', cnt[0].n)

  await p.$disconnect()
})().catch(e => { console.error(e); process.exit(1) })
