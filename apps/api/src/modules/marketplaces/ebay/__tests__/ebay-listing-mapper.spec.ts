/**
 * C11c — pure-function mapper tests.
 *
 * The mappers are fully deterministic; no DB, no HTTP, no auth
 * state. These tests nail down every field-mapping decision the
 * user confirmed in planning.
 */

import {
  buildTitle,
  truncateDescription,
  resolveBrand,
  resolveEan,
  buildAspects,
  pickImages,
  pickTranslation,
  resolvePrice,
  availableStockForEbay,
  resolveWeight,
  buildInventoryItemPayload,
  buildOfferPayload,
  MappingBlockError,
  EAN_DOES_NOT_APPLY,
  BRAND_FALLBACK,
  type MapperProduct,
  type MapperVariant,
  type MapperListing,
} from '../ebay-listing-mapper'

// ──────────────────────────────────────────────────────────────
// buildTitle
// ──────────────────────────────────────────────────────────────

describe('buildTitle', () => {
  it('concatenates name — color size when all fit within 80', () => {
    expect(buildTitle('Herren Hemd', 'Schwarz', 'L')).toBe('Herren Hemd — Schwarz L')
  })

  it('handles missing color/size gracefully', () => {
    expect(buildTitle('Herren Hemd', null, null)).toBe('Herren Hemd')
    expect(buildTitle('Herren Hemd', 'Schwarz', null)).toBe('Herren Hemd — Schwarz')
    expect(buildTitle('Herren Hemd', null, 'L')).toBe('Herren Hemd — L')
    expect(buildTitle('Herren Hemd', '', '')).toBe('Herren Hemd')
  })

  it('truncates name with ellipsis when full title > 80 chars, keeps suffix', () => {
    const long = 'Super lange Produktbezeichnung die über 80 Zeichen lang ist weil Admin faul war'
    const result = buildTitle(long, 'Schwarz', 'L')
    expect(result.length).toBeLessThanOrEqual(80)
    expect(result.endsWith(' — Schwarz L')).toBe(true)
    expect(result).toContain('…')
  })

  it('trims whitespace from color/size tokens', () => {
    expect(buildTitle('Hemd', '  Schwarz  ', '  L  ')).toBe('Hemd — Schwarz L')
  })
})

// ──────────────────────────────────────────────────────────────
// truncateDescription
// ──────────────────────────────────────────────────────────────

describe('truncateDescription', () => {
  it('returns empty string for null / undefined / empty / whitespace', () => {
    expect(truncateDescription(null)).toBe('')
    expect(truncateDescription(undefined)).toBe('')
    expect(truncateDescription('')).toBe('')
    expect(truncateDescription('   ')).toBe('')
  })

  it('returns trimmed content under the limit unchanged', () => {
    expect(truncateDescription('  Hello world  ')).toBe('Hello world')
  })

  it('truncates at 499_500 + ellipsis when exceeded', () => {
    const big = 'A'.repeat(500_000)
    const out = truncateDescription(big)
    expect(out.length).toBe(499_501) // 499_500 chars + 1-char ellipsis
    expect(out.endsWith('…')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────
// resolveBrand
// ──────────────────────────────────────────────────────────────

describe('resolveBrand', () => {
  it('falls back to "Malak Bekleidung" for null/empty/whitespace', () => {
    expect(resolveBrand(null)).toBe(BRAND_FALLBACK)
    expect(resolveBrand('')).toBe(BRAND_FALLBACK)
    expect(resolveBrand('   ')).toBe(BRAND_FALLBACK)
    expect(resolveBrand(undefined as any)).toBe(BRAND_FALLBACK)
  })
  it('passes explicit brand through (trimmed)', () => {
    expect(resolveBrand('  Nike  ')).toBe('Nike')
  })
})

// ──────────────────────────────────────────────────────────────
// resolveEan
// ──────────────────────────────────────────────────────────────

describe('resolveEan', () => {
  it('returns "Does not apply" for null / empty', () => {
    expect(resolveEan(null)).toBe(EAN_DOES_NOT_APPLY)
    expect(resolveEan('')).toBe(EAN_DOES_NOT_APPLY)
    expect(resolveEan(undefined as any)).toBe(EAN_DOES_NOT_APPLY)
  })
  it('passes valid EAN-8 / UPC-12 / EAN-13 / GTIN-14', () => {
    expect(resolveEan('12345678')).toBe('12345678')
    expect(resolveEan('123456789012')).toBe('123456789012')
    expect(resolveEan('1234567890123')).toBe('1234567890123')
    expect(resolveEan('12345678901234')).toBe('12345678901234')
  })
  it('returns "Does not apply" for non-numeric / wrong-length barcodes', () => {
    expect(resolveEan('MAL-000165-ANT-L')).toBe(EAN_DOES_NOT_APPLY) // SKU fallback
    expect(resolveEan('1234567')).toBe(EAN_DOES_NOT_APPLY) // too short
    expect(resolveEan('123456789012345')).toBe(EAN_DOES_NOT_APPLY) // too long
    expect(resolveEan('1234ABC8901')).toBe(EAN_DOES_NOT_APPLY) // mixed
  })
})

// ──────────────────────────────────────────────────────────────
// buildAspects
// ──────────────────────────────────────────────────────────────

describe('buildAspects', () => {
  it('always includes Brand', () => {
    expect(buildAspects('Malak Bekleidung', null, null)).toEqual({
      Brand: ['Malak Bekleidung'],
    })
  })
  it('includes Color and Size when present', () => {
    expect(buildAspects('Malak', 'Schwarz', 'L')).toEqual({
      Brand: ['Malak'],
      Color: ['Schwarz'],
      Size: ['L'],
    })
  })
  it('skips Color/Size if empty/whitespace', () => {
    expect(buildAspects('Malak', '   ', 'L')).toEqual({
      Brand: ['Malak'],
      Size: ['L'],
    })
  })
})

// ──────────────────────────────────────────────────────────────
// pickImages
// ──────────────────────────────────────────────────────────────

describe('pickImages', () => {
  const imgs: MapperProduct['images'] = [
    { url: 'a.jpg', colorName: 'Schwarz', isPrimary: false, sortOrder: 2 },
    { url: 'b.jpg', colorName: 'Schwarz', isPrimary: true, sortOrder: 3 },
    { url: 'c.jpg', colorName: 'Blau', isPrimary: false, sortOrder: 1 },
    { url: 'd.jpg', colorName: null, isPrimary: false, sortOrder: 5 },
  ]

  it('filters by variant color, primary first', () => {
    expect(pickImages(imgs, 'Schwarz')).toEqual(['b.jpg', 'a.jpg'])
  })

  it('falls back to all images if color filter returns empty', () => {
    const result = pickImages(imgs, 'Grün')
    // all 4 images, primary first then sortOrder
    expect(result[0]).toBe('b.jpg') // isPrimary
    expect(result.length).toBe(4)
  })

  it('returns ALL sorted when color is null/empty', () => {
    const result = pickImages(imgs, null)
    expect(result[0]).toBe('b.jpg') // primary wins
    expect(result.length).toBe(4)
  })

  it('caps at 12 images', () => {
    const manyImgs: MapperProduct['images'] = Array.from({ length: 20 }, (_, i) => ({
      url: `img-${i}.jpg`,
      colorName: 'Schwarz',
      isPrimary: i === 0,
      sortOrder: i,
    }))
    expect(pickImages(manyImgs, 'Schwarz')).toHaveLength(12)
  })

  it('returns empty array when input is empty', () => {
    expect(pickImages([], 'Schwarz')).toEqual([])
  })
})

// ──────────────────────────────────────────────────────────────
// pickTranslation
// ──────────────────────────────────────────────────────────────

describe('pickTranslation', () => {
  it('prefers de', () => {
    expect(
      pickTranslation([
        { language: 'en', name: 'Shirt', description: 'en-desc' },
        { language: 'de', name: 'Hemd', description: 'de-desc' },
      ]),
    ).toEqual({ name: 'Hemd', description: 'de-desc' })
  })
  it('falls back to en when de absent', () => {
    expect(
      pickTranslation([
        { language: 'en', name: 'Shirt', description: 'en-desc' },
        { language: 'ar', name: 'قميص', description: 'ar-desc' },
      ]),
    ).toEqual({ name: 'Shirt', description: 'en-desc' })
  })
  it('falls back to any translation when de/en absent', () => {
    expect(
      pickTranslation([{ language: 'ar', name: 'قميص', description: null }]),
    ).toEqual({ name: 'قميص', description: null })
  })
})

// ──────────────────────────────────────────────────────────────
// resolvePrice — F1/F2 user decisions
// ──────────────────────────────────────────────────────────────

describe('resolvePrice', () => {
  const product = { basePrice: '20.00', salePrice: null }
  const variant = { priceModifier: '0' }

  it('uses channelPrice when explicit, no margin warning if >= threshold', () => {
    // basePrice 20, × 1.15 = 23. channelPrice 25 is above → no warning.
    const result = resolvePrice({ channelPrice: '25.00', safetyStock: 1 }, product, variant)
    expect(result.priceStr).toBe('25.00')
    expect(result.isFallback).toBe(false)
    expect(result.hasMarginWarning).toBe(false)
  })

  it('raises margin warning when channelPrice explicit and < threshold', () => {
    // basePrice 20, × 1.15 = 23. channelPrice 22 is below → warning.
    const result = resolvePrice({ channelPrice: '22.00', safetyStock: 1 }, product, variant)
    expect(result.hasMarginWarning).toBe(true)
  })

  it('uses fallback (shop price) with NO warning when channelPrice null — F2 user decision', () => {
    const result = resolvePrice({ channelPrice: null, safetyStock: 1 }, product, variant)
    expect(result.priceStr).toBe('20.00')
    expect(result.isFallback).toBe(true)
    expect(result.hasMarginWarning).toBe(false)
  })

  it('empty-string channelPrice treated as null (fallback, no warning)', () => {
    const result = resolvePrice({ channelPrice: '', safetyStock: 1 }, product, variant)
    expect(result.isFallback).toBe(true)
    expect(result.hasMarginWarning).toBe(false)
  })

  it('computes effective shop price from salePrice when set — F1 user decision', () => {
    // salePrice 15 wins over basePrice 20. threshold = 17.25.
    // channelPrice 17 → below → warning.
    const result = resolvePrice(
      { channelPrice: '17.00', safetyStock: 1 },
      { basePrice: '20.00', salePrice: '15.00' },
      variant,
    )
    expect(result.hasMarginWarning).toBe(true)
  })

  it('includes variant priceModifier in effective shop price calc', () => {
    // basePrice 20 + priceModifier 5 = 25. threshold = 28.75.
    // channelPrice 28 → below → warning.
    const result = resolvePrice(
      { channelPrice: '28.00', safetyStock: 1 },
      { basePrice: '20.00', salePrice: null },
      { priceModifier: '5.00' },
    )
    expect(result.hasMarginWarning).toBe(true)
  })

  it('formats price with 2 decimals', () => {
    const result = resolvePrice({ channelPrice: '30', safetyStock: 1 }, product, variant)
    expect(result.priceStr).toBe('30.00')
  })
})

// ──────────────────────────────────────────────────────────────
// availableStockForEbay
// ──────────────────────────────────────────────────────────────

describe('availableStockForEbay', () => {
  it('max-per-warehouse minus safetyStock', () => {
    const rows = [
      { quantityOnHand: 10, quantityReserved: 2 }, // 8
      { quantityOnHand: 5, quantityReserved: 0 }, // 5
    ]
    expect(availableStockForEbay(rows, 1)).toBe(7) // max(8,5) - 1
  })

  it('clamps to 0 when safetyStock exceeds max available', () => {
    const rows = [{ quantityOnHand: 2, quantityReserved: 0 }]
    expect(availableStockForEbay(rows, 5)).toBe(0)
  })

  it('clamps to 0 on empty inventory', () => {
    expect(availableStockForEbay([], 1)).toBe(0)
  })

  it('never returns negative values', () => {
    const rows = [{ quantityOnHand: 0, quantityReserved: 10 }]
    expect(availableStockForEbay(rows, 1)).toBe(0)
  })
})

// ──────────────────────────────────────────────────────────────
// resolveWeight — BLOCKING on null
// ──────────────────────────────────────────────────────────────

describe('resolveWeight', () => {
  const base: MapperVariant = {
    id: 'v1',
    sku: 'MAL-001-SCH-M',
    barcode: null,
    color: 'Schwarz',
    size: 'M',
    priceModifier: '0',
    weightGrams: 250,
  }

  it('returns weight in grams when set', () => {
    expect(resolveWeight(base)).toEqual({ value: 250, unit: 'GRAM' })
  })

  it('throws MappingBlockError with code weight_missing when null', () => {
    expect(() => resolveWeight({ ...base, weightGrams: null })).toThrow(MappingBlockError)
    try {
      resolveWeight({ ...base, weightGrams: null })
    } catch (e: any) {
      expect(e.code).toBe('weight_missing')
      expect(e.message).toContain('MAL-001-SCH-M')
    }
  })

  it('throws on 0 / negative / NaN', () => {
    expect(() => resolveWeight({ ...base, weightGrams: 0 })).toThrow(MappingBlockError)
    expect(() => resolveWeight({ ...base, weightGrams: -5 })).toThrow(MappingBlockError)
  })
})

// ──────────────────────────────────────────────────────────────
// buildInventoryItemPayload — end-to-end
// ──────────────────────────────────────────────────────────────

describe('buildInventoryItemPayload', () => {
  const listing: MapperListing = { channelPrice: null, safetyStock: 1 }
  const product: MapperProduct = {
    id: 'p1',
    slug: 'herren-hemd',
    brand: 'Malak',
    basePrice: '49.99',
    salePrice: null,
    category: { ebayCategoryId: '11483' },
    translations: [
      { language: 'de', name: 'Herren Hemd', description: 'Ein tolles Hemd' },
    ],
    images: [
      { url: 'https://cdn.malak.com/img1.jpg', colorName: 'Schwarz', isPrimary: true, sortOrder: 1 },
    ],
  }
  const variant: MapperVariant = {
    id: 'v1',
    sku: 'MAL-001-SCH-L',
    barcode: '1234567890123',
    color: 'Schwarz',
    size: 'L',
    priceModifier: '0',
    weightGrams: 300,
  }
  const inventory = [{ quantityOnHand: 10, quantityReserved: 2 }]

  it('builds complete inventory-item payload with all fields', () => {
    const payload = buildInventoryItemPayload(listing, product, variant, inventory)
    expect(payload.availability.shipToLocationAvailability.quantity).toBe(7) // 8 - safetyStock 1
    expect(payload.condition).toBe('NEW')
    expect(payload.product.title).toBe('Herren Hemd — Schwarz L')
    expect(payload.product.description).toBe('Ein tolles Hemd')
    expect(payload.product.brand).toBe('Malak')
    expect(payload.product.ean).toEqual(['1234567890123'])
    expect(payload.product.aspects).toEqual({
      Brand: ['Malak'],
      Color: ['Schwarz'],
      Size: ['L'],
    })
    expect(payload.product.imageUrls).toEqual(['https://cdn.malak.com/img1.jpg'])
    expect(payload.packageWeightAndSize.weight).toEqual({ value: 300, unit: 'GRAM' })
  })

  it('throws MappingBlockError(no_images) when product has zero images', () => {
    const noImgProduct = { ...product, images: [] }
    expect(() =>
      buildInventoryItemPayload(listing, noImgProduct, variant, inventory),
    ).toThrow(MappingBlockError)
  })

  it('throws MappingBlockError(weight_missing) when variant weight null', () => {
    expect(() =>
      buildInventoryItemPayload(listing, product, { ...variant, weightGrams: null }, inventory),
    ).toThrow(MappingBlockError)
  })
})

// ──────────────────────────────────────────────────────────────
// buildOfferPayload — end-to-end
// ──────────────────────────────────────────────────────────────

describe('buildOfferPayload', () => {
  const listing: MapperListing = { channelPrice: '60.00', safetyStock: 1 }
  const product: MapperProduct = {
    id: 'p1',
    slug: 'herren-hemd',
    brand: 'Malak',
    basePrice: '49.99',
    salePrice: null,
    category: { ebayCategoryId: '11483' },
    translations: [{ language: 'de', name: 'Hemd', description: 'Beschreibung' }],
    images: [{ url: 'a.jpg', colorName: 'Schwarz', isPrimary: true, sortOrder: 0 }],
  }
  const variant: MapperVariant = {
    id: 'v1',
    sku: 'MAL-001-SCH-L',
    barcode: '1234567890123',
    color: 'Schwarz',
    size: 'L',
    priceModifier: '0',
    weightGrams: 300,
  }
  const inventory = [{ quantityOnHand: 10, quantityReserved: 2 }]
  const policyIds = {
    fulfillmentPolicyId: 'f-1',
    paymentPolicyId: 'p-1',
    returnPolicyId: 'r-1',
  }

  it('builds complete offer payload with all eBay required fields', () => {
    const { payload, price } = buildOfferPayload({
      listing, product, variant, inventoryRows: inventory,
      policyIds, merchantLocationKey: 'malak-lager-berlin',
    })
    expect(payload.sku).toBe('MAL-001-SCH-L')
    expect(payload.marketplaceId).toBe('EBAY_DE')
    expect(payload.format).toBe('FIXED_PRICE')
    expect(payload.availableQuantity).toBe(7)
    expect(payload.categoryId).toBe('11483')
    expect(payload.listingPolicies).toEqual(policyIds)
    expect(payload.pricingSummary.price).toEqual({ value: '60.00', currency: 'EUR' })
    expect(payload.merchantLocationKey).toBe('malak-lager-berlin')
    expect(payload.listingDescription).toBe('Beschreibung')
    expect(price.isFallback).toBe(false)
  })

  it('throws MappingBlockError(missing_ebay_category_id) when category has no ebay id', () => {
    expect(() =>
      buildOfferPayload({
        listing, product: { ...product, category: { ebayCategoryId: null } },
        variant, inventoryRows: inventory, policyIds, merchantLocationKey: 'k',
      }),
    ).toThrow(MappingBlockError)
    try {
      buildOfferPayload({
        listing, product: { ...product, category: null as any },
        variant, inventoryRows: inventory, policyIds, merchantLocationKey: 'k',
      })
    } catch (e: any) {
      expect(e.code).toBe('missing_ebay_category_id')
    }
  })

  it('surfaces margin-warning from price resolution', () => {
    // channelPrice 20 < basePrice 49.99 * 1.15
    const { price } = buildOfferPayload({
      listing: { channelPrice: '20.00', safetyStock: 1 },
      product, variant, inventoryRows: inventory,
      policyIds, merchantLocationKey: 'k',
    })
    expect(price.hasMarginWarning).toBe(true)
  })
})
