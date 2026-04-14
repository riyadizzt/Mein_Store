/**
 * Tests for the PDP size-dropdown logic (Zalando-style hybrid).
 *
 * Pins the contract of `availableSizesForCurrentColor` and `isColorAvailable`
 * which live in apps/web/src/app/[locale]/products/[slug]/product-client-premium.tsx.
 * The PDP itself is React + Next; we re-implement the pure helpers here so we
 * can fast-test the behaviour without booting the framework.
 */

import { compareSizes } from '../products.service'

interface Variant {
  id?: string
  color?: string
  size?: string
  isActive: boolean
  stock: number
}

function makeHelpers(variants: Variant[], selectedColor?: string) {
  const isColorAvailable = (color: string) =>
    variants.some((v) => v.color === color && v.isActive && v.stock > 0)

  const availableSizesForCurrentColor = (() => {
    const filtered = variants.filter((v) => {
      if (!v.isActive || v.stock <= 0 || !v.size) return false
      return selectedColor ? v.color === selectedColor : true
    })
    return [...new Set<string>(filtered.map((v) => v.size as string))].sort(compareSizes)
  })()

  const findVariant = (color?: string, size?: string) =>
    variants.find((v) =>
      (color ? v.color === color : true) &&
      (size ? v.size === size : true) &&
      v.isActive,
    )

  const findStockedVariant = (color?: string, size?: string) =>
    variants.find((v) =>
      (color ? v.color === color : true) &&
      (size ? v.size === size : true) &&
      v.isActive &&
      v.stock > 0,
    )

  // Mirrors the color click handler in product-client-premium.tsx
  const pickVariantOnColorClick = (color: string, currentSize?: string) =>
    findStockedVariant(color, currentSize) ??
    findStockedVariant(color) ??
    findVariant(color, currentSize) ??
    findVariant(color)

  return {
    isColorAvailable,
    availableSizesForCurrentColor,
    findVariant,
    findStockedVariant,
    pickVariantOnColorClick,
  }
}

// Real-world fixture: the user's Cargo Pants
const cargoPants: Variant[] = [
  { color: 'Weiß', size: 'S', isActive: true, stock: 29 },
  { color: 'Blau', size: 'M', isActive: true, stock: 18 },
  { color: 'Grün', size: 'L', isActive: true, stock: 48 },
]

describe('PDP — Zalando-style size dropdown', () => {
  // ─────────────────────────────────────────────
  describe('Cargo Pants (3 non-overlapping variants)', () => {
    it('Weiß selected → dropdown shows only [S]', () => {
      const { availableSizesForCurrentColor } = makeHelpers(cargoPants, 'Weiß')
      expect(availableSizesForCurrentColor).toEqual(['S'])
    })

    it('Blau selected → dropdown shows only [M]', () => {
      const { availableSizesForCurrentColor } = makeHelpers(cargoPants, 'Blau')
      expect(availableSizesForCurrentColor).toEqual(['M'])
    })

    it('Grün selected → dropdown shows only [L]', () => {
      const { availableSizesForCurrentColor } = makeHelpers(cargoPants, 'Grün')
      expect(availableSizesForCurrentColor).toEqual(['L'])
    })

    it('No color selected → dropdown shows ALL sizes that exist anywhere', () => {
      const { availableSizesForCurrentColor } = makeHelpers(cargoPants, undefined)
      expect(availableSizesForCurrentColor).toEqual(['S', 'M', 'L'])
    })

    it('all 3 colors are available (each has stock)', () => {
      const { isColorAvailable } = makeHelpers(cargoPants, 'Weiß')
      expect(isColorAvailable('Weiß')).toBe(true)
      expect(isColorAvailable('Blau')).toBe(true)
      expect(isColorAvailable('Grün')).toBe(true)
    })
  })

  // ─────────────────────────────────────────────
  describe('Product with overlap (Schwarz has S+M+L, Rot has only M)', () => {
    const overlap: Variant[] = [
      { color: 'Schwarz', size: 'S', isActive: true, stock: 5 },
      { color: 'Schwarz', size: 'M', isActive: true, stock: 3 },
      { color: 'Schwarz', size: 'L', isActive: true, stock: 8 },
      { color: 'Rot',     size: 'M', isActive: true, stock: 7 },
    ]

    it('Schwarz selected → dropdown shows [S, M, L]', () => {
      const { availableSizesForCurrentColor } = makeHelpers(overlap, 'Schwarz')
      expect(availableSizesForCurrentColor).toEqual(['S', 'M', 'L'])
    })

    it('Rot selected → dropdown shows only [M]', () => {
      const { availableSizesForCurrentColor } = makeHelpers(overlap, 'Rot')
      expect(availableSizesForCurrentColor).toEqual(['M'])
    })
  })

  // ─────────────────────────────────────────────
  describe('Out-of-stock filtering', () => {
    const partial: Variant[] = [
      { color: 'Schwarz', size: 'S', isActive: true, stock: 5 },
      { color: 'Schwarz', size: 'M', isActive: true, stock: 0 }, // OOS
      { color: 'Schwarz', size: 'L', isActive: true, stock: 12 },
      { color: 'Schwarz', size: 'XL', isActive: true, stock: 0 }, // OOS
    ]

    it('OOS sizes are excluded from dropdown', () => {
      const { availableSizesForCurrentColor } = makeHelpers(partial, 'Schwarz')
      expect(availableSizesForCurrentColor).toEqual(['S', 'L'])
      expect(availableSizesForCurrentColor).not.toContain('M')
      expect(availableSizesForCurrentColor).not.toContain('XL')
    })
  })

  // ─────────────────────────────────────────────
  describe('Color completely out of stock', () => {
    const colorOOS: Variant[] = [
      { color: 'Schwarz', size: 'S', isActive: true, stock: 5 },
      { color: 'Rot', size: 'M', isActive: true, stock: 0 }, // every Rot variant is OOS
      { color: 'Rot', size: 'L', isActive: true, stock: 0 },
    ]

    it('Rot is NOT available (all Rot variants have 0 stock)', () => {
      const { isColorAvailable } = makeHelpers(colorOOS, 'Schwarz')
      expect(isColorAvailable('Rot')).toBe(false)
    })

    it('Schwarz IS available', () => {
      const { isColorAvailable } = makeHelpers(colorOOS, 'Schwarz')
      expect(isColorAvailable('Schwarz')).toBe(true)
    })

    it('selecting Rot would yield an empty dropdown (red error message)', () => {
      const { availableSizesForCurrentColor } = makeHelpers(colorOOS, 'Rot')
      expect(availableSizesForCurrentColor).toEqual([])
    })
  })

  // ─────────────────────────────────────────────
  describe('Inactive variants are filtered out', () => {
    const withInactive: Variant[] = [
      { color: 'Schwarz', size: 'S', isActive: true, stock: 10 },
      { color: 'Schwarz', size: 'M', isActive: false, stock: 999 }, // ignored
      { color: 'Schwarz', size: 'L', isActive: true, stock: 5 },
    ]

    it('inactive variants do not appear in dropdown', () => {
      const { availableSizesForCurrentColor } = makeHelpers(withInactive, 'Schwarz')
      expect(availableSizesForCurrentColor).toEqual(['S', 'L'])
      expect(availableSizesForCurrentColor).not.toContain('M')
    })
  })

  // ─────────────────────────────────────────────
  describe('Sort order — sizes follow canonical clothing order', () => {
    const allSizes: Variant[] = [
      { color: 'A', size: 'XL', isActive: true, stock: 1 },
      { color: 'A', size: 'XS', isActive: true, stock: 1 },
      { color: 'A', size: '3XL', isActive: true, stock: 1 },
      { color: 'A', size: 'M', isActive: true, stock: 1 },
      { color: 'A', size: 'S', isActive: true, stock: 1 },
      { color: 'A', size: 'L', isActive: true, stock: 1 },
      { color: 'A', size: 'XXL', isActive: true, stock: 1 },
    ]

    it('returns sizes in S→M→L→XL order, not alphabetical', () => {
      const { availableSizesForCurrentColor } = makeHelpers(allSizes, 'A')
      expect(availableSizesForCurrentColor).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'])
    })

    it('numeric sizes come before letter sizes', () => {
      const mixed: Variant[] = [
        { color: 'A', size: '40', isActive: true, stock: 1 },
        { color: 'A', size: 'M', isActive: true, stock: 1 },
        { color: 'A', size: '38', isActive: true, stock: 1 },
        { color: 'A', size: 'L', isActive: true, stock: 1 },
      ]
      const { availableSizesForCurrentColor } = makeHelpers(mixed, 'A')
      expect(availableSizesForCurrentColor).toEqual(['38', '40', 'M', 'L'])
    })
  })

  // ─────────────────────────────────────────────
  describe('Single-axis product (sizes only, no colors)', () => {
    const sizeOnly: Variant[] = [
      { size: 'S', isActive: true, stock: 10 },
      { size: 'M', isActive: true, stock: 0 },
      { size: 'L', isActive: true, stock: 5 },
    ]

    it('dropdown shows sizes with stock, ignoring color', () => {
      const { availableSizesForCurrentColor } = makeHelpers(sizeOnly, undefined)
      expect(availableSizesForCurrentColor).toEqual(['S', 'L'])
    })
  })

  // ─────────────────────────────────────────────
  // Regression: real bug from Sport Pants jogginghose-comfort
  //   Rot+S = 4 stock  ✅
  //   Rot+M = 0 stock  ❌
  //   Rot+L = 0 stock  ❌
  //   Schwarz+L = 45 stock
  //   Grün+M = 47 stock
  //
  // User was on Schwarz+L. Clicked Rot. Naive logic landed on Rot+L (0 stock)
  // because findVariant matches the existing size first without checking stock.
  // Fix: pickVariantOnColorClick prefers a STOCKED variant.
  // ─────────────────────────────────────────────
  describe('Regression: Sport Pants — Rot has only S in stock', () => {
    const sportPants: Variant[] = [
      { id: 'rot-s', color: 'Rot', size: 'S', isActive: true, stock: 4 },
      { id: 'rot-m', color: 'Rot', size: 'M', isActive: true, stock: 0 },
      { id: 'rot-l', color: 'Rot', size: 'L', isActive: true, stock: 0 },
      { id: 'gru-m', color: 'Grün', size: 'M', isActive: true, stock: 47 },
      { id: 'sch-l', color: 'Schwarz', size: 'L', isActive: true, stock: 45 },
    ]

    it('clicking Rot (was Schwarz+L) lands on Rot+S (stock 4), NOT Rot+L (stock 0)', () => {
      const { pickVariantOnColorClick } = makeHelpers(sportPants, 'Schwarz')
      const v = pickVariantOnColorClick('Rot', 'L')
      expect(v?.id).toBe('rot-s') // ← fix: in-stock variant wins
      expect(v?.stock).toBeGreaterThan(0)
    })

    it('clicking Rot (was Grün+M) lands on Rot+S, NOT Rot+M', () => {
      const { pickVariantOnColorClick } = makeHelpers(sportPants, 'Grün')
      const v = pickVariantOnColorClick('Rot', 'M')
      expect(v?.id).toBe('rot-s')
      expect(v?.stock).toBeGreaterThan(0)
    })

    it('clicking Rot with no previous size still lands on Rot+S', () => {
      const { pickVariantOnColorClick } = makeHelpers(sportPants)
      const v = pickVariantOnColorClick('Rot')
      expect(v?.id).toBe('rot-s')
      expect(v?.stock).toBeGreaterThan(0)
    })

    it('Rot dropdown shows only [S] (M and L are filtered out)', () => {
      const { availableSizesForCurrentColor } = makeHelpers(sportPants, 'Rot')
      expect(availableSizesForCurrentColor).toEqual(['S'])
    })

    it('Rot is correctly marked as available (Rot+S has stock)', () => {
      const { isColorAvailable } = makeHelpers(sportPants, 'Schwarz')
      expect(isColorAvailable('Rot')).toBe(true)
    })

    it('clicking Schwarz from Rot+S lands on Schwarz+L (different size, but in stock)', () => {
      const { pickVariantOnColorClick } = makeHelpers(sportPants, 'Rot')
      // Schwarz has no S variant, so it must fall back to a stocked size of Schwarz
      const v = pickVariantOnColorClick('Schwarz', 'S')
      expect(v?.id).toBe('sch-l')
      expect(v?.stock).toBe(45)
    })
  })

  // ─────────────────────────────────────────────
  describe('Edge: variant has no size at all', () => {
    const noSize: Variant[] = [
      { color: 'Schwarz', size: undefined, isActive: true, stock: 10 },
    ]

    it('returns empty array (variant has no size to show)', () => {
      const { availableSizesForCurrentColor } = makeHelpers(noSize, 'Schwarz')
      expect(availableSizesForCurrentColor).toEqual([])
    })
  })
})
