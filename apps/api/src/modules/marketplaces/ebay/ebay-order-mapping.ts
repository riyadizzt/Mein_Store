/**
 * eBay Sell-Fulfillment Order — pure mapping helpers.
 *
 * Sister to ebay-listing-mapper.ts (C11). All pure functions:
 *   - parseEbayOrderPayload(raw): defensive shape narrowing
 *   - splitFullName(fullName): single-string → firstName/lastName
 *   - splitDeAddress(addressLine1): 3-stage hybrid split
 *   - isInternalRedirectAddress(line): 'ebay:...' sentinel detection
 *   - buildSyntheticEmail(externalBuyerRef): synthetic email format
 *   - verifyTotalsMatch(payload): 1-cent tolerance check, throws
 *   - verifyMarketplaceAndCurrency(payload): EBAY_DE + EUR enforce
 *
 * Throws MappingError (from ../core/errors) for all structural failures.
 * The adapter (ebay-order.adapter.ts) consumes these helpers.
 *
 * Discovery: Phase-B audit (2026-04-27) of eBay Sell-Fulfillment API
 * docs surfaced 14 edge cases this module guards against. See README
 * comment block before each helper for the specific gotcha it covers.
 */

import { MappingError } from '../core/errors'

// ──────────────────────────────────────────────────────────────
// EbayGetOrderPayload — type-narrowed eBay shape
// ──────────────────────────────────────────────────────────────
//
// Defensive parsing produces this. We do NOT trust eBay to send
// every documented field every time — PII-suppression after 90
// days strips fullName/email/phone, and forward-compat fields may
// disappear. This interface lists ONLY what the adapter actually
// reads + writes.

export interface EbayGetOrderPayload {
  orderId: string
  buyer: { username: string }
  fulfillmentStartInstructions: Array<{
    shippingStep: {
      shipTo: {
        fullName?: string
        contactAddress: {
          addressLine1: string
          addressLine2?: string
          city: string
          postalCode: string
          countryCode: string
        }
        email?: string
        primaryPhone?: { phoneNumber?: string }
      }
    }
  }>
  lineItems: Array<{
    lineItemId: string
    sku?: string
    title?: string
    quantity: number
    lineItemCost: { value: string; currency: string }
    legacyItemId?: string
    listingMarketplaceId?: string
    purchaseMarketplaceId?: string
  }>
  pricingSummary: {
    priceSubtotal: { value: string; currency: string }
    deliveryCost: { value: string; currency: string }
    priceDiscount?: { value: string; currency: string }
    total: { value: string; currency: string }
  }
}

// ──────────────────────────────────────────────────────────────
// parseEbayOrderPayload
// ──────────────────────────────────────────────────────────────
// Validates the minimum shape the adapter relies on. Throws
// MappingError on missing required fields. NOT a full schema
// validator — just enough to make TypeScript narrowing safe.

export function parseEbayOrderPayload(raw: unknown): EbayGetOrderPayload {
  if (!raw || typeof raw !== 'object') {
    throw new MappingError('eBay payload is not an object')
  }
  const p = raw as any
  if (typeof p.orderId !== 'string' || p.orderId.length === 0) {
    throw new MappingError('eBay payload missing orderId')
  }
  if (!p.buyer || typeof p.buyer.username !== 'string') {
    throw new MappingError(`eBay payload ${p.orderId} missing buyer.username`)
  }
  if (!Array.isArray(p.lineItems) || p.lineItems.length === 0) {
    throw new MappingError(`eBay payload ${p.orderId} has no lineItems`)
  }
  if (
    !Array.isArray(p.fulfillmentStartInstructions) ||
    p.fulfillmentStartInstructions.length === 0
  ) {
    throw new MappingError(
      `eBay payload ${p.orderId} has no fulfillmentStartInstructions`,
    )
  }
  const shipTo = p.fulfillmentStartInstructions[0]?.shippingStep?.shipTo
  if (!shipTo || !shipTo.contactAddress) {
    throw new MappingError(
      `eBay payload ${p.orderId} missing shipTo.contactAddress`,
    )
  }
  if (
    typeof shipTo.contactAddress.addressLine1 !== 'string' ||
    typeof shipTo.contactAddress.city !== 'string' ||
    typeof shipTo.contactAddress.postalCode !== 'string' ||
    typeof shipTo.contactAddress.countryCode !== 'string'
  ) {
    throw new MappingError(
      `eBay payload ${p.orderId} contactAddress incomplete`,
    )
  }
  if (
    !p.pricingSummary?.priceSubtotal?.value ||
    !p.pricingSummary?.deliveryCost?.value ||
    !p.pricingSummary?.total?.value
  ) {
    throw new MappingError(
      `eBay payload ${p.orderId} pricingSummary incomplete`,
    )
  }
  return p as EbayGetOrderPayload
}

// ──────────────────────────────────────────────────────────────
// Internal-redirect sentinel detection
// ──────────────────────────────────────────────────────────────
// eBay uses 'ebay:<token>' in addressLine1 for in-store-pickup
// or Authenticity-Guarantee redirect. We don't enable those
// programs — adapter rejects them at mapToOrderDraft.

export function isInternalRedirectAddress(addressLine1: string): boolean {
  return /^ebay:/i.test((addressLine1 ?? '').trim())
}

// ──────────────────────────────────────────────────────────────
// splitFullName — eBay shipTo.fullName is single string
// ──────────────────────────────────────────────────────────────
// Heuristic: split on the LAST whitespace. Best effort — German
// double-surnames ("Anna Becker-Müller") or compound names are
// preserved as lastName because that's the conservative choice
// for shipping-label rendering.

export function splitFullName(fullName: string | undefined | null): {
  firstName: string
  lastName: string
} {
  const raw = (fullName ?? '').trim()
  if (raw.length === 0) return { firstName: '', lastName: '' }
  const lastSpace = raw.lastIndexOf(' ')
  if (lastSpace < 0) return { firstName: raw, lastName: '' }
  return {
    firstName: raw.slice(0, lastSpace).trim(),
    lastName: raw.slice(lastSpace + 1).trim(),
  }
}

// ──────────────────────────────────────────────────────────────
// splitDeAddress — 3-stage hybrid for German addresses
// ──────────────────────────────────────────────────────────────
// eBay sends addressLine1 as combined "Streetname Number" for DE.
// Our DHL provider expects them separately (verified Phase B audit
// of dhl.provider.ts:153-154). Three-stage fallback per Q4:
//
//   Stage 1: trailing simple number (Hauptstrasse 42 → "Hauptstrasse" + "42")
//   Stage 2: trailing range/alphanumeric (Berliner Str. 12-14, Goethestr. 5b)
//   Stage 3: fallback — return entire input as street, houseNumber=''
//            Caller logs warning, order proceeds. Admin fixes label
//            manually before shipment if needed.

export function splitDeAddress(addressLine1: string): {
  street: string
  houseNumber: string
} {
  const raw = (addressLine1 ?? '').trim()
  if (raw.length === 0) return { street: '', houseNumber: '' }

  // Single regex catches Stages 1 + 2.
  // Trailing token: digit(s), optionally + letter, optionally + range
  // (the range tail allows alphanumerics so "100/B" works alongside
  // "12-14"). Examples:
  //   "Hauptstrasse 42"     → street="Hauptstrasse",   number="42"
  //   "Goethestr. 5b"       → street="Goethestr.",     number="5b"
  //   "Berliner Str. 12-14" → street="Berliner Str.",  number="12-14"
  //   "Allee 100/B"         → street="Allee",          number="100/B"
  const m = raw.match(
    /^(.+?)\s+(\d+(?:[a-zA-Z])?(?:[\-/][a-zA-Z0-9]+)?)\s*$/,
  )
  if (m && m[1] && m[2]) {
    return { street: m[1].trim(), houseNumber: m[2].trim() }
  }

  // Stage 3 fallback — caller logs warning.
  return { street: raw, houseNumber: '' }
}

// ──────────────────────────────────────────────────────────────
// buildSyntheticEmail
// ──────────────────────────────────────────────────────────────
// eBay's shipTo.email is always a `<hash>@members.ebay.com` proxy.
// We do NOT use it as our user-table contact (it's not stable, not
// real, not addressable for transactional emails). Instead we
// synthesize a stable identifier per buyer-username.
//
// Format per types.ts doc: ebay-{externalBuyerRef}@marketplace.local
// Lowercased so Prisma's email-unique lookup is case-insensitive-safe.

export function buildSyntheticEmail(externalBuyerRef: string): string {
  const safe = (externalBuyerRef ?? '').trim().toLowerCase()
  return `ebay-${safe}@marketplace.local`
}

// ──────────────────────────────────────────────────────────────
// verifyMarketplaceAndCurrency
// ──────────────────────────────────────────────────────────────
// Pre-launch hard guards. We only sell EBAY_DE / EUR. Anything else
// is a data-quality red flag — surface as MappingError so admin sees
// the import failure with a clear reason.

export function verifyMarketplaceAndCurrency(
  payload: EbayGetOrderPayload,
): void {
  // Marketplace check — every line must be EBAY_DE-listed AND EBAY_DE-purchased
  for (const li of payload.lineItems) {
    if (li.listingMarketplaceId && li.listingMarketplaceId !== 'EBAY_DE') {
      throw new MappingError(
        `lineItem ${li.lineItemId} listingMarketplaceId='${li.listingMarketplaceId}', expected EBAY_DE`,
      )
    }
    if (li.purchaseMarketplaceId && li.purchaseMarketplaceId !== 'EBAY_DE') {
      throw new MappingError(
        `lineItem ${li.lineItemId} purchaseMarketplaceId='${li.purchaseMarketplaceId}', expected EBAY_DE`,
      )
    }
  }
  // Currency check — pricingSummary.total must be EUR
  if (payload.pricingSummary.total.currency !== 'EUR') {
    throw new MappingError(
      `pricingSummary.total.currency='${payload.pricingSummary.total.currency}', expected EUR`,
    )
  }
}

// ──────────────────────────────────────────────────────────────
// verifyTotalsMatch
// ──────────────────────────────────────────────────────────────
// Adapter-side sanity check (Q5 decision). pricingSummary.total
// is authoritative — but we cross-check the line-item sum to catch
// payload-corruption / partial-refund edge cases that would land
// us with wrong order amounts.
//
// Tolerance: 1 cent. eBay sometimes rounds per-line and produces
// sums that drift by sub-cent.

export function verifyTotalsMatch(payload: EbayGetOrderPayload): void {
  let lineSum = 0
  for (const li of payload.lineItems) {
    lineSum += Number(li.lineItemCost.value)
  }
  const subtotal = Number(payload.pricingSummary.priceSubtotal.value)
  // eBay docs: priceSubtotal is "cumulative costs of all line items
  // before any discount". Must match line-item sum within 1 cent.
  if (Math.abs(lineSum - subtotal) > 0.01) {
    throw new MappingError(
      `totals mismatch: lineSum=${lineSum.toFixed(2)} vs priceSubtotal=${subtotal.toFixed(2)}`,
    )
  }
}
