/**
 * Phase-1 Live-DB Read-Only Verification.
 * Pure SELECT queries, no writes. Validates Phase-1 invariants in prod state.
 */
import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()

async function main() {
  console.log('=== Phase-1 Live-DB Read-Only Verification ===\n')

  // 1) ChannelProductListing row count + status breakdown
  const cplBreak = await p.$queryRawUnsafe<any[]>(`
    SELECT status, channel, COUNT(*)::int AS n
    FROM channel_product_listings
    GROUP BY status, channel
    ORDER BY channel, status`)
  console.log('ChannelProductListing breakdown:')
  console.log(cplBreak.length === 0 ? '  (empty — Phase-1-Launch-State)' : cplBreak)

  // 2) Any orphan ChannelProductListings? (missing variant/product)
  const orphans = await p.$queryRawUnsafe<any[]>(`
    SELECT cpl.id, cpl.variant_id
    FROM channel_product_listings cpl
    LEFT JOIN product_variants v ON v.id = cpl.variant_id
    WHERE v.id IS NULL
    LIMIT 5`)
  console.log(`\nOrphan CPL rows (variant gone): ${orphans.length}`)

  // 3) Paused listings without pause_reason
  const badPause = await p.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*)::int AS n FROM channel_product_listings
    WHERE status='paused' AND pause_reason IS NULL`)
  console.log(`Paused listings with NULL pause_reason: ${badPause[0].n}`)

  // 4) Active listings with safety_stock = 0 (unusual — sanity)
  const zeroSafety = await p.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*)::int AS n FROM channel_product_listings
    WHERE status='active' AND safety_stock = 0`)
  console.log(`Active listings with safety_stock = 0: ${zeroSafety[0].n}`)

  // 5) SalesChannelConfig — any channels configured?
  const sccSummary = await p.$queryRawUnsafe<any[]>(`
    SELECT channel, is_active, feed_token IS NOT NULL AS has_feed_token,
           access_token IS NOT NULL AS has_access_token
    FROM sales_channel_configs
    ORDER BY channel`)
  console.log('\nSalesChannelConfig:')
  console.log(sccSummary.length === 0 ? '  (empty — tokens not yet generated)' : sccSummary)

  // 6) Categories with google-taxonomy
  const gCats = await p.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*) FILTER (WHERE google_category_id IS NOT NULL) AS with_id,
           COUNT(*)                                               AS total
    FROM categories`)
  console.log(`\nCategories with google_category_id: ${gCats[0].with_id}/${gCats[0].total}`)

  // 7) Products by channel enablement (FA-05 pre-existing vs new)
  const chEn = await p.$queryRawUnsafe<any[]>(`
    SELECT 
      SUM(CASE WHEN channel_facebook THEN 1 ELSE 0 END)::int AS fb_on,
      SUM(CASE WHEN channel_tiktok   THEN 1 ELSE 0 END)::int AS tt_on,
      SUM(CASE WHEN channel_google   THEN 1 ELSE 0 END)::int AS go_on,
      SUM(CASE WHEN channel_whatsapp THEN 1 ELSE 0 END)::int AS wa_on,
      COUNT(*)::int AS total
    FROM products WHERE deleted_at IS NULL`)
  console.log(`\nProducts channel-enabled (existing, retained post-FA-05):`)
  console.log(chEn[0])

  // 8) Schema-Drift Check — no unexpected channel-listings columns
  const cplSchema = await p.$queryRawUnsafe<any[]>(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='channel_product_listings'
    ORDER BY ordinal_position`)
  console.log(`\nChannelProductListing columns (total): ${cplSchema.length}`)
  const names = cplSchema.map((c: any) => c.column_name).join(', ')
  console.log(`  ${names}`)

  // 9) GoBD sanity: Recent invoices still pdf-linked correctly
  const invRecent = await p.$queryRawUnsafe<any[]>(`
    SELECT 
      COUNT(*) FILTER (WHERE pdf_url IS NOT NULL)::int AS with_pdf,
      COUNT(*)                                         AS total
    FROM invoices WHERE created_at > now() - interval '7 days'`)
  console.log(`\nRecent invoices (7d): ${invRecent[0].with_pdf}/${invRecent[0].total} have pdf_url`)

  // 10) Inventory integrity (max_per_wh semantics still preserved)
  const invDrift = await p.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*)::int AS n FROM inventory
    WHERE quantity_reserved > quantity_on_hand`)
  console.log(`\nInventory drift (quantity_reserved > quantity_on_hand): ${invDrift[0].n} — should be 0 (CHECK constraint enforced)`)

  await p.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
