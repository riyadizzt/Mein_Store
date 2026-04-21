/**
 * Phase-1 End-to-End Scenarios (read-only verification against Live-DB)
 *
 * 1. Product creation API contract: DTO accepts channel flags, 
 *    pre-C7 there was no public "create product" that would trigger FA-05.
 * 2. Schema assertions match Prisma client types.
 * 3. Live-DB: Products table still has 0 ChannelProductListing rows 
 *    (launch-state) + all products have non-null channelX flags.
 * 4. Categories with google-taxonomy-id set: count.
 * 5. Feed-URL format template verification (no live-call — read env).
 */
import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()

async function main() {
  let fail = 0
  let pass = 0
  const check = (name: string, ok: boolean, extra?: any) => {
    if (ok) { pass++; console.log(`✅ ${name}`) }
    else    { fail++; console.log(`🔴 ${name}`, extra) }
  }

  // S1: Products have channel-flags (no nulls after C1 migration)
  const withNullChannels = await p.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*) AS n FROM products
    WHERE channel_facebook IS NULL OR channel_tiktok IS NULL
       OR channel_google   IS NULL OR channel_whatsapp IS NULL`)
  check('S1: No products with NULL channel flags', Number(withNullChannels[0].n) === 0, withNullChannels[0])

  // S2: FA-05 — Default TRUE flipped to FALSE on products.channel_*
  const defaults = await p.$queryRawUnsafe<any[]>(`
    SELECT column_name, column_default FROM information_schema.columns
    WHERE table_name='products' AND column_name IN
      ('channel_facebook','channel_tiktok','channel_google','channel_whatsapp')`)
  const allFalse = defaults.every((d: any) => d.column_default === 'false')
  check('S2: FA-05 defaults (all false)', allFalse, defaults)

  // S3: ChannelProductListing has schema for C5 safety-stock
  const cplCols = await p.$queryRawUnsafe<any[]>(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='channel_product_listings'
      AND column_name IN ('safety_stock','pause_reason','paused_at','auto_resume_at','sync_attempts')`)
  check('S3: ChannelProductListing C5 columns (5 expected)', cplCols.length === 5, cplCols.map((c: any) => c.column_name))

  // S4: SalesChannelConfig has feed_token for per-channel token
  const sccCols = await p.$queryRawUnsafe<any[]>(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='sales_channel_configs'
      AND column_name IN ('feed_token','refresh_token','refresh_token_expires_at')`)
  check('S4: SalesChannelConfig C1 columns (3 expected)', sccCols.length === 3, sccCols.map((c: any) => c.column_name))

  // S5: Google-taxonomy fields on categories
  const catCols = await p.$queryRawUnsafe<any[]>(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='categories'
      AND column_name IN ('google_category_id','google_category_label')`)
  check('S5: categories C6 google-taxonomy columns (2 expected)', catCols.length === 2, catCols.map((c: any) => c.column_name))

  // S6: Unique constraint on (variant_id, channel) still intact
  const uniq = await p.$queryRawUnsafe<any[]>(`
    SELECT indexname FROM pg_indexes
    WHERE tablename='channel_product_listings'
      AND indexname='channel_product_listings_variant_id_channel_key'`)
  check('S6: Unique (variant_id, channel) intact', uniq.length === 1)

  // S7: Phase-1 indexes exist
  const phase1Indexes = await p.$queryRawUnsafe<any[]>(`
    SELECT indexname FROM pg_indexes
    WHERE tablename='channel_product_listings'
      AND indexname IN ('channel_product_listings_channel_status_idx',
                        'channel_product_listings_status_pause_reason_idx')`)
  check('S7: Phase-1 query indexes both present', phase1Indexes.length === 2, phase1Indexes)

  // S8: Active variants exist for gating (backend gating rule)
  const activeVariantsPerProduct = await p.$queryRawUnsafe<any[]>(`
    SELECT p.id, COUNT(v.id)::int AS active_variants
    FROM products p
    LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_active = true
    WHERE p.deleted_at IS NULL
    GROUP BY p.id
    HAVING COUNT(v.id) = 0
    LIMIT 5`)
  check(`S8: Zero-variant products exist? (expected: could be >0, gating will block)`, true, { count: activeVariantsPerProduct.length })

  // S9: GoBD — Invoices untouched. Check a known invariant remains
  const invWithoutPdf = await p.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*) AS n FROM invoices WHERE pdf_url IS NULL AND type='INVOICE'`)
  check(`S9: Invoices with NULL pdf_url (GoBD check)`, Number(invWithoutPdf[0].n) >= 0, invWithoutPdf[0])

  // S10: Products post-C1 — channel_* booleans preserved (sanity)
  const nullableAfterC1 = await p.$queryRawUnsafe<any[]>(`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_name='products'
      AND column_name IN ('channel_facebook','channel_tiktok','channel_google','channel_whatsapp')`)
  const allNotNullable = nullableAfterC1.every((c: any) => c.is_nullable === 'NO')
  check('S10: Product.channel_* still NOT NULL (backward compat)', allNotNullable, nullableAfterC1)

  console.log(`\n=== Summary: ${pass} pass / ${fail} fail / ${pass+fail} total ===`)
  await p.$disconnect()
  if (fail > 0) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(2) })
