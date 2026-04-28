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
  resolveDepartment,
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
  buildInventoryItemGroupKey,
  buildGroupTitle,
  buildGroupAspects,
  buildVariesBy,
  buildInventoryItemGroupPayload,
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
  it('emits localized DE aspect keys (Marke/Herstellernummer)', () => {
    expect(buildAspects('Malak Bekleidung', null, null, 'MAL-X-1', null)).toEqual({
      Marke: ['Malak Bekleidung'],
      Herstellernummer: ['MAL-X-1'],
    })
  })
  it('includes Farbe and Größe when present', () => {
    expect(buildAspects('Malak', 'Schwarz', 'L', 'MAL-Y-2', null)).toEqual({
      Marke: ['Malak'],
      Herstellernummer: ['MAL-Y-2'],
      Farbe: ['Schwarz'],
      Größe: ['L'],
    })
  })
  it('skips Farbe/Größe if empty/whitespace', () => {
    expect(buildAspects('Malak', '   ', 'L', 'MAL-Z-3', null)).toEqual({
      Marke: ['Malak'],
      Herstellernummer: ['MAL-Z-3'],
      Größe: ['L'],
    })
  })
  it('Herstellernummer = the variant SKU (eBay needs unique Brand+MPN)', () => {
    // Regression guard: MPN must be unique-per-variant. eBay rejects
    // placeholder values like "Does Not Apply" when paired with a real Brand.
    expect(buildAspects('Malak', null, null, 'MAL-HERREN-SCH-40', null).Herstellernummer)
      .toEqual(['MAL-HERREN-SCH-40'])
  })
  it('two variants of the same product get distinct Herstellernummer', () => {
    const a = buildAspects('Malak', 'Schwarz', '40', 'MAL-HERREN-SCH-40', null)
    const b = buildAspects('Malak', 'Schwarz', '41', 'MAL-HERREN-SCH-41', null)
    expect(a.Herstellernummer).not.toEqual(b.Herstellernummer)
  })
  it('does NOT emit English aspect keys (Brand/MPN/Color/Size)', () => {
    // Regression guard: localized keys only on EBAY_DE.
    const a = buildAspects('Malak', 'Schwarz', 'L', 'MAL-X-1', null)
    expect(a.Brand).toBeUndefined()
    expect(a.MPN).toBeUndefined()
    expect(a.Color).toBeUndefined()
    expect(a.Size).toBeUndefined()
  })
  it('emits Abteilung when department is provided', () => {
    expect(buildAspects('Malak', 'Schwarz', '40', 'MAL-X-1', 'Herren')).toEqual({
      Marke: ['Malak'],
      Herstellernummer: ['MAL-X-1'],
      Farbe: ['Schwarz'],
      Größe: ['40'],
      Abteilung: ['Herren'],
    })
  })
  it('omits Abteilung when department is null', () => {
    const a = buildAspects('Malak', null, null, 'MAL-X-1', null)
    expect(a.Abteilung).toBeUndefined()
  })
  it('omits Abteilung when department is empty/whitespace', () => {
    const a = buildAspects('Malak', null, null, 'MAL-X-1', '   ')
    expect(a.Abteilung).toBeUndefined()
  })
})

describe('resolveDepartment', () => {
  it('maps known top-level slugs to DE labels', () => {
    expect(resolveDepartment('herren')).toBe('Herren')
    expect(resolveDepartment('damen')).toBe('Damen')
    expect(resolveDepartment('jungen')).toBe('Jungen')
    expect(resolveDepartment('maedchen')).toBe('Mädchen')
    expect(resolveDepartment('baybay')).toBe('Baby')
  })
  it('returns null for unknown slug', () => {
    expect(resolveDepartment('foobar')).toBeNull()
  })
  it('returns null for null / undefined / empty', () => {
    expect(resolveDepartment(null)).toBeNull()
    expect(resolveDepartment(undefined)).toBeNull()
    expect(resolveDepartment('')).toBeNull()
  })
  it('is case-insensitive on input slug', () => {
    expect(resolveDepartment('HERREN')).toBe('Herren')
    expect(resolveDepartment('Damen')).toBe('Damen')
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
    category: { ebayCategoryId: '11483', departmentSlug: 'herren' },
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
    expect(payload.product.mpn).toBe('MAL-001-SCH-L') // top-level mpn = variant.sku
    expect(payload.product.ean).toEqual(['1234567890123'])
    expect(payload.product.aspects).toEqual({
      Marke: ['Malak'],
      Herstellernummer: ['MAL-001-SCH-L'],
      Farbe: ['Schwarz'],
      Größe: ['L'],
      Abteilung: ['Herren'],
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

  it('includes top-level product.mpn = variant.sku (defense-in-depth)', () => {
    const payload = buildInventoryItemPayload(listing, product, variant, inventory)
    expect(payload.product.mpn).toBe('MAL-001-SCH-L')
  })

  it('throws MappingBlockError(department_unmapped) when category is null', () => {
    const noCatProduct = { ...product, category: null }
    try {
      buildInventoryItemPayload(listing, noCatProduct, variant, inventory)
      throw new Error('expected MappingBlockError')
    } catch (e: any) {
      expect(e).toBeInstanceOf(MappingBlockError)
      expect(e.code).toBe('department_unmapped')
    }
  })

  it('throws MappingBlockError(department_unmapped) for unknown departmentSlug', () => {
    const badCatProduct = {
      ...product,
      category: { ebayCategoryId: '11483', departmentSlug: 'unknown-slug' },
    }
    try {
      buildInventoryItemPayload(listing, badCatProduct, variant, inventory)
      throw new Error('expected MappingBlockError')
    } catch (e: any) {
      expect(e).toBeInstanceOf(MappingBlockError)
      expect(e.code).toBe('department_unmapped')
    }
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
    category: { ebayCategoryId: '11483', departmentSlug: 'herren' },
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
        listing, product: { ...product, category: { ebayCategoryId: null, departmentSlug: 'herren' } },
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

// ──────────────────────────────────────────────────────────────
// Multi-Variation Group Helpers (C11.6)
// ──────────────────────────────────────────────────────────────

describe('buildInventoryItemGroupKey', () => {
  it('returns MAL_<productId>', () => {
    expect(buildInventoryItemGroupKey('p1')).toBe('MAL_p1')
  })
  it('truncates to 50 chars when productId is very long', () => {
    const long = 'x'.repeat(100)
    const result = buildInventoryItemGroupKey(long)
    expect(result.length).toBe(50)
    expect(result.startsWith('MAL_')).toBe(true)
  })
})

describe('buildGroupTitle', () => {
  it('returns trimmed product name unchanged when ≤80 chars', () => {
    expect(buildGroupTitle('Herren Schuhe')).toBe('Herren Schuhe')
    expect(buildGroupTitle('  Herren Schuhe  ')).toBe('Herren Schuhe')
  })
  it('truncates to 77 + "..." when >80 chars', () => {
    const long = 'x'.repeat(100)
    const result = buildGroupTitle(long)
    expect(result.length).toBe(80)
    expect(result.endsWith('...')).toBe(true)
  })
  it('throws MappingBlockError(group_title_missing) on empty/whitespace', () => {
    try {
      buildGroupTitle('')
      throw new Error('expected throw')
    } catch (e: any) {
      expect(e).toBeInstanceOf(MappingBlockError)
      expect(e.code).toBe('group_title_missing')
    }
  })
})

describe('buildGroupAspects', () => {
  it('emits only Marke + Abteilung (no Color/Size/MPN)', () => {
    const result = buildGroupAspects('Malak', 'Herren')
    expect(result).toEqual({
      Marke: ['Malak'],
      Abteilung: ['Herren'],
    })
  })
})

describe('buildVariesBy', () => {
  it('extracts unique colors + sizes from variants list', () => {
    const variants = [
      { color: 'Schwarz', size: '40' },
      { color: 'Schwarz', size: '41' },
      { color: 'Weiß', size: '40' },
      { color: 'Weiß', size: '41' },
    ]
    const result = buildVariesBy(variants)
    expect(result.specifications).toContainEqual({ name: 'Farbe', values: ['Schwarz', 'Weiß'] })
    expect(result.specifications).toContainEqual({ name: 'Größe', values: ['40', '41'] })
  })

  it('keeps both axes even with 1 unique value (size variation, single color)', () => {
    const variants = [
      { color: 'Schwarz', size: '40' },
      { color: 'Schwarz', size: '41' },
    ]
    const result = buildVariesBy(variants)
    expect(result.specifications).toContainEqual({ name: 'Farbe', values: ['Schwarz'] })
    expect(result.specifications).toContainEqual({ name: 'Größe', values: ['40', '41'] })
  })

  it('keeps both axes even with 1 unique value (color variation, single size)', () => {
    const variants = [
      { color: 'Schwarz', size: 'M' },
      { color: 'Weiß', size: 'M' },
    ]
    const result = buildVariesBy(variants)
    expect(result.specifications).toContainEqual({ name: 'Farbe', values: ['Schwarz', 'Weiß'] })
    expect(result.specifications).toContainEqual({ name: 'Größe', values: ['M'] })
  })

  it('emits axis only when at least 1 variant has a non-empty value (size only when no color anywhere)', () => {
    const variants = [
      { color: null as string | null, size: '40' },
      { color: null as string | null, size: '41' },
    ]
    const result = buildVariesBy(variants)
    expect(result.specifications).toHaveLength(1)
    expect(result.specifications[0].name).toBe('Größe')
  })

  it('throws no_varying_aspects when both empty', () => {
    try {
      buildVariesBy([{ color: null, size: null }, { color: null, size: null }])
      throw new Error('expected throw')
    } catch (e: any) {
      expect(e).toBeInstanceOf(MappingBlockError)
      expect(e.code).toBe('no_varying_aspects')
    }
  })

  it('aspectsImageVariesBy=["Farbe"] when 2+ colors', () => {
    const variants = [
      { color: 'Schwarz', size: '40' },
      { color: 'Weiß', size: '40' },
    ]
    expect(buildVariesBy(variants).aspectsImageVariesBy).toEqual(['Farbe'])
  })

  it('aspectsImageVariesBy=[] when 1 color', () => {
    const variants = [
      { color: 'Schwarz', size: '40' },
      { color: 'Schwarz', size: '41' },
    ]
    expect(buildVariesBy(variants).aspectsImageVariesBy).toEqual([])
  })
})

describe('buildInventoryItemGroupPayload', () => {
  const product: MapperProduct = {
    id: 'p1',
    slug: 'herren-schuhe',
    brand: 'Malak',
    basePrice: '59.90',
    salePrice: null,
    category: { ebayCategoryId: '15709', departmentSlug: 'herren' },
    translations: [{ language: 'de', name: 'Herren Schuhe', description: 'Tolle Schuhe' }],
    images: [
      { url: 'https://cdn.malak.com/black-1.jpg', colorName: 'Schwarz', isPrimary: true, sortOrder: 0 },
      { url: 'https://cdn.malak.com/white-1.jpg', colorName: 'Weiß', isPrimary: false, sortOrder: 1 },
    ],
  }
  const variants: MapperVariant[] = [
    { id: 'v1', sku: 'MAL-HER-SCH-40', barcode: null, color: 'Schwarz', size: '40', priceModifier: '0', weightGrams: 500 },
    { id: 'v2', sku: 'MAL-HER-WEI-40', barcode: null, color: 'Weiß', size: '40', priceModifier: '0', weightGrams: 500 },
  ]

  it('happy path: 2-variant minimal → full payload', () => {
    const result = buildInventoryItemGroupPayload(product, variants, 'Herren')
    expect(result.title).toBe('Herren Schuhe')
    expect(result.description).toBe('Tolle Schuhe')
    expect(result.aspects).toEqual({ Marke: ['Malak'], Abteilung: ['Herren'] })
    expect(result.variantSKUs).toEqual(['MAL-HER-SCH-40', 'MAL-HER-WEI-40'])
    expect(result.variesBy.specifications).toContainEqual({ name: 'Farbe', values: ['Schwarz', 'Weiß'] })
    expect(result.imageUrls).toHaveLength(2)
  })

  it('throws group_needs_2_plus_variants when 1 variant', () => {
    try {
      buildInventoryItemGroupPayload(product, [variants[0]], 'Herren')
      throw new Error('expected throw')
    } catch (e: any) {
      expect(e).toBeInstanceOf(MappingBlockError)
      expect(e.code).toBe('group_needs_2_plus_variants')
    }
  })

  it('throws group_no_images when product has no images', () => {
    const noImg = { ...product, images: [] }
    try {
      buildInventoryItemGroupPayload(noImg, variants, 'Herren')
      throw new Error('expected throw')
    } catch (e: any) {
      expect(e).toBeInstanceOf(MappingBlockError)
      expect(e.code).toBe('group_no_images')
    }
  })

  it('imageUrls includes ALL product images (no color filter)', () => {
    const result = buildInventoryItemGroupPayload(product, variants, 'Herren')
    expect(result.imageUrls).toContain('https://cdn.malak.com/black-1.jpg')
    expect(result.imageUrls).toContain('https://cdn.malak.com/white-1.jpg')
  })

  it('variantSKUs matches variants order', () => {
    const result = buildInventoryItemGroupPayload(product, variants, 'Herren')
    expect(result.variantSKUs).toEqual(variants.map((v) => v.sku))
  })
})
