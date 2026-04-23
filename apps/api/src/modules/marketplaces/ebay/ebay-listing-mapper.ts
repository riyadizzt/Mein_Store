/**
 * eBay Listing Payload Mappers (C11c).
 *
 * Pure functions that translate our DB shapes into the JSON
 * bodies eBay's Sell-Inventory API expects. Isolated from the
 * service layer so each mapping rule is trivially unit-testable
 * without mocking DB or HTTP.
 *
 * Scope (per Phase-2 C11c specification):
 *   - Title: `{name} — {color} {size}`, max 80 chars, name gets
 *     truncated first, color/size always preserved.
 *   - Description: truncate at 499500 chars + ellipsis (eBay's
 *     500_000 char limit).
 *   - Brand: fallback to "Malak Bekleidung" if null.
 *   - EAN: fallback to literal "Does not apply" if barcode null
 *     or non-numeric (barcode=SKU fallback from Phase-1 is NOT a
 *     valid EAN).
 *   - Weight: BLOCKING — weightGrams null → mapper throws
 *     MappingBlockError('weight_missing'). Admin must populate
 *     the variant's weightGrams before publish.
 *   - Aspects: Brand + Color + Size only (C11 scope). Additional
 *     aspects arrive in C17 via getItemAspectsForCategory.
 *   - Images: filter by variant.color's colorName, sort by
 *     isPrimary DESC + sortOrder ASC, cap at 12. If zero after
 *     filter, fallback to ALL product images. If still zero,
 *     throw MappingBlockError('no_images').
 *   - Price-warning: channelPrice explicit AND
 *     channelPrice < (salePrice ?? basePrice + priceModifier) * 1.15
 *     → { hasMarginWarning: true }. null channelPrice = no warning.
 */

// ──────────────────────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────────────────────

/**
 * Thrown from mapping when a listing cannot be published because
 * of a missing blocking field. Service layer catches this and
 * writes `status='rejected'` + syncError to the listing row —
 * distinguished from a transient eBay-API failure.
 */
export class MappingBlockError extends Error {
  readonly code: string
  constructor(code: string, message?: string) {
    super(message ?? code)
    this.name = 'MappingBlockError'
    this.code = code
  }
}

// ──────────────────────────────────────────────────────────────
// Input shapes — documented here as TypeScript types so mapper
// consumers know exactly what to pass. Matches Prisma result
// shape with strategic include()s.
// ──────────────────────────────────────────────────────────────

export interface MapperProduct {
  id: string
  slug: string
  brand: string | null
  basePrice: string | number
  salePrice: string | number | null
  category: {
    ebayCategoryId: string | null
  } | null
  translations: Array<{
    language: 'ar' | 'en' | 'de'
    name: string
    description: string | null
  }>
  images: Array<{
    url: string
    colorName: string | null
    isPrimary: boolean
    sortOrder: number
  }>
}

export interface MapperVariant {
  id: string
  sku: string
  barcode: string | null
  color: string | null
  size: string | null
  priceModifier: string | number
  weightGrams: number | null
}

export interface MapperListing {
  channelPrice: string | number | null
  safetyStock: number
}

// ──────────────────────────────────────────────────────────────
// Title — eBay caps at 80 chars
// ──────────────────────────────────────────────────────────────

const EBAY_TITLE_MAX = 80

/**
 * Build the eBay title: "{productName} — {color} {size}".
 * Strategy on overflow: the variant suffix (" — color size") is
 * always kept, the productName is ellipsis-truncated. If the
 * suffix alone is already at the limit (pathological), the title
 * is just the suffix.
 */
export function buildTitle(
  productName: string,
  color: string | null,
  size: string | null,
): string {
  const suffix = buildVariantSuffix(color, size)
  const full = `${productName}${suffix}`
  if (full.length <= EBAY_TITLE_MAX) return full

  // Need to truncate the name part. Budget for name = 80 - suffix - 1 (ellipsis).
  const suffixLen = suffix.length
  const ellipsis = '…'
  const nameBudget = EBAY_TITLE_MAX - suffixLen - ellipsis.length
  if (nameBudget <= 0) {
    // Suffix alone exceeds the limit — unlikely but defend against.
    // Trim suffix to fit if possible, else hard-truncate whole title.
    return full.slice(0, EBAY_TITLE_MAX)
  }
  const trimmedName = productName.slice(0, nameBudget).trimEnd()
  return `${trimmedName}${ellipsis}${suffix}`
}

function buildVariantSuffix(color: string | null, size: string | null): string {
  const hasColor = Boolean(color && color.trim().length > 0)
  const hasSize = Boolean(size && size.trim().length > 0)
  if (!hasColor && !hasSize) return ''
  const parts: string[] = []
  if (hasColor) parts.push(color!.trim())
  if (hasSize) parts.push(size!.trim())
  return ` — ${parts.join(' ')}`
}

// ──────────────────────────────────────────────────────────────
// Description — eBay caps at 500_000 chars
// ──────────────────────────────────────────────────────────────

const EBAY_DESCRIPTION_MAX = 499_500

export function truncateDescription(description: string | null | undefined): string {
  const d = (description ?? '').trim()
  if (d.length === 0) return ''
  if (d.length <= EBAY_DESCRIPTION_MAX) return d
  return d.slice(0, EBAY_DESCRIPTION_MAX) + '…'
}

// ──────────────────────────────────────────────────────────────
// Brand fallback
// ──────────────────────────────────────────────────────────────

export const BRAND_FALLBACK = 'Malak Bekleidung'

export function resolveBrand(brand: string | null | undefined): string {
  const b = (brand ?? '').trim()
  return b.length > 0 ? b : BRAND_FALLBACK
}

// ──────────────────────────────────────────────────────────────
// EAN — only numeric barcodes of 8/12/13/14 digits are real EANs.
// Our Phase-1 invariant sets barcode=SKU as a fallback; that's NOT
// a valid EAN, and eBay documents a literal string "Does not apply"
// as the escape hatch for no-EAN listings.
// ──────────────────────────────────────────────────────────────

export const EAN_DOES_NOT_APPLY = 'Does not apply'

export function resolveEan(barcode: string | null | undefined): string {
  const b = (barcode ?? '').trim()
  if (b.length === 0) return EAN_DOES_NOT_APPLY
  // eBay-accepted EAN-ish lengths: EAN-8, UPC-12, EAN-13, GTIN-14.
  const validLengths = new Set([8, 12, 13, 14])
  const allDigits = /^\d+$/.test(b)
  if (allDigits && validLengths.has(b.length)) return b
  return EAN_DOES_NOT_APPLY
}

// ──────────────────────────────────────────────────────────────
// Aspects — eBay expects { [aspectName]: string[] }.
// For C11c we send Brand + Color + Size only.
// ──────────────────────────────────────────────────────────────

export function buildAspects(
  brand: string,
  color: string | null,
  size: string | null,
): Record<string, string[]> {
  const aspects: Record<string, string[]> = {
    Brand: [brand],
  }
  const c = (color ?? '').trim()
  const s = (size ?? '').trim()
  if (c.length > 0) aspects.Color = [c]
  if (s.length > 0) aspects.Size = [s]
  return aspects
}

// ──────────────────────────────────────────────────────────────
// Image selection — filter + sort + cap at 12.
// Filter by variant.color matching ProductImage.colorName; if the
// filter empties the list, fall back to ALL product images.
// Sort: isPrimary DESC → sortOrder ASC.
// ──────────────────────────────────────────────────────────────

const EBAY_IMAGE_MAX = 12

export function pickImages(
  productImages: MapperProduct['images'],
  variantColor: string | null,
): string[] {
  if (!productImages || productImages.length === 0) return []

  // Sort helper: primary first, then lowest sortOrder first.
  const byPreference = (
    a: MapperProduct['images'][number],
    b: MapperProduct['images'][number],
  ) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  }

  let pool = productImages
  if (variantColor && variantColor.trim().length > 0) {
    const matching = productImages.filter(
      (img) => (img.colorName ?? '').trim() === variantColor.trim(),
    )
    // Filter narrowed to zero → fall back to ALL images.
    if (matching.length > 0) pool = matching
  }

  return pool
    .slice()
    .sort(byPreference)
    .slice(0, EBAY_IMAGE_MAX)
    .map((img) => img.url)
    .filter((url) => typeof url === 'string' && url.length > 0)
}

// ──────────────────────────────────────────────────────────────
// Translation picker — prefer de, fallback en, then any
// ──────────────────────────────────────────────────────────────

export function pickTranslation(
  translations: MapperProduct['translations'],
): { name: string; description: string | null } {
  const de = translations.find((t) => t.language === 'de')
  if (de) return { name: de.name, description: de.description }
  const en = translations.find((t) => t.language === 'en')
  if (en) return { name: en.name, description: en.description }
  const any = translations[0]
  return {
    name: any?.name ?? '',
    description: any?.description ?? null,
  }
}

// ──────────────────────────────────────────────────────────────
// Price resolution — channelPrice wins, else effective shop price.
// Returns both the decimal and metadata for the price warning.
// ──────────────────────────────────────────────────────────────

export interface PriceResolution {
  /** Final price to send to eBay, as string with 2 decimals. */
  priceStr: string
  /** Numeric view, for the margin-warning check. */
  priceNumber: number
  /** True = channelPrice was null, we used the shop fallback. */
  isFallback: boolean
  /** True = channelPrice is explicit AND below effective shop × 1.15. */
  hasMarginWarning: boolean
}

export function resolvePrice(
  listing: MapperListing,
  product: { basePrice: string | number; salePrice: string | number | null },
  variant: { priceModifier: string | number },
): PriceResolution {
  const basePrice = Number(product.basePrice)
  const salePrice = product.salePrice != null ? Number(product.salePrice) : null
  const priceModifier = Number(variant.priceModifier) || 0

  // Effective shop price: salePrice if set, else basePrice + variant modifier.
  const effectiveShopPrice =
    salePrice != null ? salePrice : basePrice + priceModifier

  const channelPriceNum =
    listing.channelPrice != null && listing.channelPrice !== ''
      ? Number(listing.channelPrice)
      : null

  if (channelPriceNum != null && !Number.isNaN(channelPriceNum)) {
    const threshold = effectiveShopPrice * 1.15
    return {
      priceStr: channelPriceNum.toFixed(2),
      priceNumber: channelPriceNum,
      isFallback: false,
      hasMarginWarning: channelPriceNum < threshold,
    }
  }

  // Fallback path — no warning per user-decision F2.
  return {
    priceStr: effectiveShopPrice.toFixed(2),
    priceNumber: effectiveShopPrice,
    isFallback: true,
    hasMarginWarning: false,
  }
}

// ──────────────────────────────────────────────────────────────
// Stock for eBay — max-per-warehouse minus safetyStock, clamped to 0.
// (Re-implements the same rule as channel-safety-stock.computeAvailableStock
// for direct use in the listing-push flow.)
// ──────────────────────────────────────────────────────────────

export function availableStockForEbay(
  inventoryRows: Array<{ quantityOnHand: number; quantityReserved: number }>,
  safetyStock: number,
): number {
  if (!inventoryRows || inventoryRows.length === 0) return 0
  const maxPerWarehouse = inventoryRows.reduce((max, r) => {
    const avail = Math.max(0, r.quantityOnHand - r.quantityReserved)
    return avail > max ? avail : max
  }, 0)
  return Math.max(0, maxPerWarehouse - safetyStock)
}

// ──────────────────────────────────────────────────────────────
// Weight — BLOCKING. eBay requires package weight for shipping.
// ──────────────────────────────────────────────────────────────

export function resolveWeight(variant: MapperVariant): {
  value: number
  unit: 'GRAM'
} {
  const g = variant.weightGrams
  if (g == null || !Number.isFinite(g) || g <= 0) {
    throw new MappingBlockError(
      'weight_missing',
      `Variante ${variant.sku} hat kein Gewicht. Bitte weightGrams pflegen.`,
    )
  }
  return { value: g, unit: 'GRAM' }
}

// ──────────────────────────────────────────────────────────────
// Full payload builders — compose the above.
// ──────────────────────────────────────────────────────────────

export interface InventoryItemPayload {
  availability: { shipToLocationAvailability: { quantity: number } }
  condition: 'NEW'
  product: {
    title: string
    description: string
    imageUrls: string[]
    brand: string
    ean: string[]
    aspects: Record<string, string[]>
  }
  packageWeightAndSize: { weight: { value: number; unit: 'GRAM' } }
}

export function buildInventoryItemPayload(
  listing: MapperListing,
  product: MapperProduct,
  variant: MapperVariant,
  inventoryRows: Array<{ quantityOnHand: number; quantityReserved: number }>,
): InventoryItemPayload {
  const translation = pickTranslation(product.translations)
  const title = buildTitle(translation.name, variant.color, variant.size)
  const description = truncateDescription(translation.description)
  const brand = resolveBrand(product.brand)
  const ean = resolveEan(variant.barcode)
  const aspects = buildAspects(brand, variant.color, variant.size)
  const images = pickImages(product.images, variant.color)
  if (images.length === 0) {
    throw new MappingBlockError(
      'no_images',
      `Variante ${variant.sku} hat keine gültigen Bilder. Bitte Produkt-Bilder pflegen.`,
    )
  }
  const weight = resolveWeight(variant) // throws on null weightGrams
  const quantity = availableStockForEbay(inventoryRows, listing.safetyStock)

  return {
    availability: { shipToLocationAvailability: { quantity } },
    condition: 'NEW',
    product: {
      title,
      description,
      imageUrls: images,
      brand,
      ean: [ean], // eBay accepts an array even for a single value
      aspects,
    },
    packageWeightAndSize: { weight },
  }
}

export interface OfferPayload {
  sku: string
  marketplaceId: 'EBAY_DE'
  format: 'FIXED_PRICE'
  availableQuantity: number
  categoryId: string
  listingPolicies: {
    fulfillmentPolicyId: string
    paymentPolicyId: string
    returnPolicyId: string
  }
  pricingSummary: {
    price: { value: string; currency: 'EUR' }
  }
  merchantLocationKey: string
  listingDescription: string
}

export function buildOfferPayload(input: {
  listing: MapperListing
  product: MapperProduct
  variant: MapperVariant
  inventoryRows: Array<{ quantityOnHand: number; quantityReserved: number }>
  policyIds: {
    fulfillmentPolicyId: string
    paymentPolicyId: string
    returnPolicyId: string
  }
  merchantLocationKey: string
}): { payload: OfferPayload; price: PriceResolution } {
  const { listing, product, variant, inventoryRows, policyIds, merchantLocationKey } = input
  const translation = pickTranslation(product.translations)
  const description = truncateDescription(translation.description)
  const price = resolvePrice(listing, product, variant)
  const availableQuantity = availableStockForEbay(inventoryRows, listing.safetyStock)

  if (!product.category?.ebayCategoryId) {
    throw new MappingBlockError(
      'missing_ebay_category_id',
      `Produkt ${product.slug} hat keine eBay-Kategorie-ID. Bitte im Kategorie-Editor pflegen.`,
    )
  }

  const payload: OfferPayload = {
    sku: variant.sku,
    marketplaceId: 'EBAY_DE',
    format: 'FIXED_PRICE',
    availableQuantity,
    categoryId: product.category.ebayCategoryId,
    listingPolicies: {
      fulfillmentPolicyId: policyIds.fulfillmentPolicyId,
      paymentPolicyId: policyIds.paymentPolicyId,
      returnPolicyId: policyIds.returnPolicyId,
    },
    pricingSummary: {
      price: { value: price.priceStr, currency: 'EUR' },
    },
    merchantLocationKey,
    listingDescription: description,
  }

  return { payload, price }
}
