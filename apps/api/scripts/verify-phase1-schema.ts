import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
;(async () => {
  console.log('=== Schema-Column Spot-Checks (C1 + C7 fields) ===')
  const catCol = await p.$queryRawUnsafe<any[]>(`
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name='categories'
      AND column_name IN ('google_category_id','google_category_label')
    ORDER BY column_name`)
  console.log('categories:', catCol)

  const scc = await p.$queryRawUnsafe<any[]>(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name='sales_channel_configs'
      AND column_name IN ('refresh_token','refresh_token_expires_at','feed_token')
    ORDER BY column_name`)
  console.log('sales_channel_configs:', scc)

  const cpl = await p.$queryRawUnsafe<any[]>(`
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name='channel_product_listings'
      AND column_name IN ('safety_stock','pause_reason','paused_at','auto_resume_at','sync_attempts')
    ORDER BY column_name`)
  console.log('channel_product_listings:', cpl)

  const pDefaults = await p.$queryRawUnsafe<any[]>(`
    SELECT column_name, column_default
    FROM information_schema.columns
    WHERE table_name='products'
      AND column_name IN ('channel_facebook','channel_tiktok','channel_google','channel_whatsapp')
    ORDER BY column_name`)
  console.log('products channel-defaults (FA-05):', pDefaults)

  const idxs = await p.$queryRawUnsafe<any[]>(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename='channel_product_listings' AND indexname LIKE '%channel%'
       OR tablename='channel_product_listings' AND indexname LIKE '%pause%'
    ORDER BY indexname`)
  console.log('channel_product_listings indexes:', idxs)

  console.log('\n=== Row-Count Smoke (read-only) ===')
  const rc = await p.$queryRawUnsafe<any[]>(`
    SELECT 'channel_product_listings' AS tbl, COUNT(*) AS n FROM channel_product_listings
    UNION ALL
    SELECT 'sales_channel_configs', COUNT(*) FROM sales_channel_configs
    UNION ALL
    SELECT 'channel_sync_logs', COUNT(*) FROM channel_sync_logs
    UNION ALL
    SELECT 'products (non-deleted)', COUNT(*) FROM products WHERE deleted_at IS NULL
    UNION ALL
    SELECT 'categories', COUNT(*) FROM categories`)
  console.log(rc)

  await p.$disconnect()
})().catch(e => { console.error(e); process.exit(1) })
