/**
 * Single source of truth for SalesChannel display labels.
 *
 * Used by both /admin/finance/page.tsx (Overview + Monthly tabs) and
 * /admin/finance/monthly-tab.tsx (byChannel breakdown table). Mirrors
 * the backend SalesChannel enum (prisma/schema.prisma:64-74) — every
 * enum value has exactly one entry here.
 *
 * Contract: when a new SalesChannel enum value lands (e.g. future
 * tiktok-shop, instagram-shop), add it here AND to ONLINE_CHANNELS in
 * finance-reports.service.ts at the same time. The two lists must stay
 * in sync — finance aggregates the keys; this module renders them.
 *
 * Pure TS — zero imports. No React, no Next, no DOM globals. Matches
 * the finance-display.ts cross-importable pattern. (apps/api Jest can
 * cross-import this for contract testing if needed.)
 */

/**
 * Canonical display labels for every SalesChannel value. eBay uses
 * official mixed-case branding "eBay" per their style guide.
 *
 * The `pos` channel is included in this map even though it's excluded
 * from finance ONLINE_CHANNELS — admin UI may still display POS data
 * elsewhere (orders list, dashboard pipeline view) and needs a label.
 */
export const CHANNEL_LABELS: Record<string, string> = {
  website: 'Webshop',
  mobile: 'Mobile App',
  pos: 'POS',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  google: 'Google',
  whatsapp: 'WhatsApp',
  ebay: 'eBay',
}

/**
 * Resolve a channel-key to its display label. Falls back to the raw key
 * for unknown values (forward-compat: a new channel added to the DB
 * before this map is updated will display its raw key, not crash).
 */
export function channelLabel(key: string | null | undefined): string {
  if (!key) return ''
  return CHANNEL_LABELS[key] ?? key
}
