/**
 * Channel-listing transition helper — Phase-1 C4.
 *
 * Given a product and a requested set of channel-boolean transitions
 * (e.g. facebook: false → true, google: true → false), apply the
 * corresponding changes to the ChannelProductListing rows.
 *
 * Transition semantics (per user Q2 decision)
 * ───────────────────────────────────────────
 *   false → true   ← "publish": upsert one row per ACTIVE variant
 *                    with status='pending'. If a row already exists
 *                    (was previously 'deleted'), it's revived to
 *                    'pending' — existing externalListingId / audit
 *                    history is preserved, per user spec.
 *
 *   true  → false  ← "unpublish": soft-delete — update all rows for
 *                    this (product, channel) to status='deleted'.
 *                    NO hard delete (audit trail + future eBay/TikTok
 *                    external-ID preservation).
 *
 *   true  → true, false → false  ← idempotent no-ops. Helper is
 *                    called only when a transition is detected, so
 *                    these cases never enter here.
 *
 * Transaction safety
 * ──────────────────
 *   The caller is expected to pass a Prisma transaction client (`tx`)
 *   acquired via `prisma.$transaction(async (tx) => { ... })`. If any
 *   listing upsert / update inside the transaction fails, the entire
 *   product update rolls back along with it — no partial state.
 *
 * Return shape
 * ────────────
 *   Returns a list of transition events so the caller can write
 *   matching audit-log entries (one CHANNEL_LISTING_ENABLED or
 *   CHANNEL_LISTING_DISABLED per affected channel).
 */

type PrismaTxClient = {
  productVariant: { findMany: (args: any) => Promise<any[]> }
  channelProductListing: {
    upsert: (args: any) => Promise<any>
    updateMany: (args: any) => Promise<any>
  }
}

export type SalesChannelSlug = 'facebook' | 'tiktok' | 'google' | 'whatsapp'

export interface ChannelTransition {
  channel: SalesChannelSlug
  from: boolean
  to: boolean
}

export interface TransitionEvent {
  channel: SalesChannelSlug
  action: 'enabled' | 'disabled'
  variantIds: string[]
  affectedRows: number
}

/**
 * Compute the transition list from a "current" and "next" state.
 * Used at the HTTP boundary so the controller can short-circuit a
 * no-op (no transitions → skip transaction entirely).
 */
export function computeTransitions(
  current: { channelFacebook: boolean; channelTiktok: boolean; channelGoogle: boolean; channelWhatsapp: boolean },
  next: { channelFacebook?: boolean; channelTiktok?: boolean; channelGoogle?: boolean; channelWhatsapp?: boolean },
): ChannelTransition[] {
  const out: ChannelTransition[] = []
  const pairs: Array<[SalesChannelSlug, keyof typeof current]> = [
    ['facebook', 'channelFacebook'],
    ['tiktok', 'channelTiktok'],
    ['google', 'channelGoogle'],
    ['whatsapp', 'channelWhatsapp'],
  ]
  for (const [channel, key] of pairs) {
    const nextVal = next[key]
    if (nextVal === undefined) continue   // unchanged in request
    if (nextVal === current[key]) continue // idempotent no-op
    out.push({ channel, from: current[key], to: nextVal })
  }
  return out
}

/**
 * Apply one transition inside an already-open transaction.
 * The caller loops over computeTransitions() output and calls this
 * per transition. Return value feeds the audit-log writer.
 */
export async function applyTransitionInTx(
  tx: PrismaTxClient,
  productId: string,
  t: ChannelTransition,
): Promise<TransitionEvent> {
  if (t.to === true) {
    // false → true: publish each active variant
    const variants: Array<{ id: string }> = await tx.productVariant.findMany({
      where: { productId, isActive: true },
      select: { id: true },
    })
    // `@@unique([variantId, channel])` means we can upsert per
    // (variant, channel). Previously-deleted rows are revived to
    // 'pending' so externalListingId + audit history stay intact.
    for (const v of variants) {
      await tx.channelProductListing.upsert({
        where: { variantId_channel: { variantId: v.id, channel: t.channel as any } },
        create: {
          productId,
          variantId: v.id,
          channel: t.channel as any,
          status: 'pending',
        },
        update: {
          status: 'pending',
          // Intentionally NOT clearing syncError / externalListingId /
          // channelPrice — those carry useful prior state for revives.
        },
      })
    }
    return {
      channel: t.channel,
      action: 'enabled',
      variantIds: variants.map((v) => v.id),
      affectedRows: variants.length,
    }
  } else {
    // true → false: soft-delete all rows for this (product, channel)
    // regardless of variant status. A row for a now-inactive variant
    // still gets marked deleted for consistency.
    const result = await tx.channelProductListing.updateMany({
      where: { productId, channel: t.channel as any, status: { not: 'deleted' } },
      data: { status: 'deleted' },
    })
    return {
      channel: t.channel,
      action: 'disabled',
      variantIds: [],
      affectedRows: result.count ?? 0,
    }
  }
}

/**
 * Build the initial-listing payload for a newly-created product.
 * Writes one `pending` row per (variant, channel) for each channel
 * flag that is TRUE on the product. Called from ProductsService.create
 * AFTER product.create but INSIDE the same $transaction.
 *
 * Note: at C4 time the schema default is `channelX: true`, so a
 * freshly-created product has all 4 flags true unless explicitly
 * overridden. C7 flips those defaults to false (FA-05).
 */
export async function createInitialListingsInTx(
  tx: PrismaTxClient & {
    channelProductListing: { createMany: (args: any) => Promise<any> }
  },
  product: {
    id: string
    channelFacebook: boolean
    channelTiktok: boolean
    channelGoogle: boolean
    channelWhatsapp: boolean
    variants: Array<{ id: string }>
  },
): Promise<number> {
  const channels: SalesChannelSlug[] = []
  if (product.channelFacebook) channels.push('facebook')
  if (product.channelTiktok) channels.push('tiktok')
  if (product.channelGoogle) channels.push('google')
  if (product.channelWhatsapp) channels.push('whatsapp')
  if (channels.length === 0 || product.variants.length === 0) return 0

  const rows = product.variants.flatMap((v) =>
    channels.map((ch) => ({
      productId: product.id,
      variantId: v.id,
      channel: ch as any,
      status: 'pending' as any,
    })),
  )
  const result = await tx.channelProductListing.createMany({
    data: rows,
    skipDuplicates: true, // defensive — repeat-create on retry
  })
  return result.count ?? rows.length
}
