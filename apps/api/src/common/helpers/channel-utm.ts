/**
 * Channel UTM parameter helper.
 *
 * Centralises the UTM param strings used by the feed generators. Before
 * C6 each feed built its own inline string — 4 slightly different
 * patterns. Consolidating here means:
 *   - Adding a new channel (eBay/TikTok Shop in Phase 2/3) only needs
 *     one map entry, not a new hand-written snippet per feed.
 *   - Analytics queries can filter on a known enum (utm_source ∈
 *     {facebook, tiktok, google, whatsapp, ebay, ...}).
 *
 * Byte-equal constraint
 * ─────────────────────
 * The EXACT strings emitted before C6 must be preserved so the
 * byte-equal regression guard in feeds-byte-equal.spec.ts continues
 * to pass. Any change to a UTM value is a breaking change for live
 * Google Analytics / Meta pixel dashboards that filter on these.
 *
 * Pre-C6 source-of-truth (feeds.service.ts):
 *   facebook  → utm_source=facebook&utm_medium=shop&utm_campaign=catalog
 *   tiktok    → utm_source=tiktok&utm_medium=shop&utm_campaign=catalog
 *   google    → utm_source=google&utm_medium=shopping&utm_campaign=feed
 *   whatsapp  → utm_source=whatsapp&utm_medium=catalog&utm_campaign=business
 */

export type ChannelUtmSource = 'facebook' | 'tiktok' | 'google' | 'whatsapp'

const UTM_TABLE: Record<ChannelUtmSource, { source: string; medium: string; campaign: string }> = {
  facebook: { source: 'facebook', medium: 'shop', campaign: 'catalog' },
  tiktok: { source: 'tiktok', medium: 'shop', campaign: 'catalog' },
  google: { source: 'google', medium: 'shopping', campaign: 'feed' },
  whatsapp: { source: 'whatsapp', medium: 'catalog', campaign: 'business' },
}

/**
 * Returns the raw `utm_source=X&utm_medium=Y&utm_campaign=Z` string
 * for the given channel. Caller prefixes it with `?` or `&` as
 * appropriate for the target URL.
 */
export function channelUtmParams(channel: ChannelUtmSource): string {
  const entry = UTM_TABLE[channel]
  return `utm_source=${entry.source}&utm_medium=${entry.medium}&utm_campaign=${entry.campaign}`
}
