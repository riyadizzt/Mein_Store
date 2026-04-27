/**
 * Pure-helper tests for ebay-order-mapping.ts (C12.2).
 *
 * Drives the test suite from the 5 fixture JSON files under
 * __tests__/fixtures/. Tests cover all 7 helpers:
 *   - parseEbayOrderPayload (defensive shape narrowing)
 *   - isInternalRedirectAddress (sentinel detection)
 *   - splitFullName (last-whitespace heuristik)
 *   - splitDeAddress (3-stage hybrid)
 *   - buildSyntheticEmail (lowercased synthetic)
 *   - verifyMarketplaceAndCurrency (EBAY_DE + EUR enforce)
 *   - verifyTotalsMatch (1-cent tolerance)
 */

import { MappingError } from '../../core/errors'
import {
  parseEbayOrderPayload,
  isInternalRedirectAddress,
  splitFullName,
  splitDeAddress,
  buildSyntheticEmail,
  verifyMarketplaceAndCurrency,
  verifyTotalsMatch,
  type EbayGetOrderPayload,
} from '../ebay-order-mapping'
import minimalFixture from './fixtures/ebay-getOrder-minimal.json'
import multiLineFixture from './fixtures/ebay-getOrder-multi-line.json'

// Deep-clone a fixture so tests don't mutate the shared module-cached JSON.
function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x))
}

// ──────────────────────────────────────────────────────────────
// parseEbayOrderPayload
// ──────────────────────────────────────────────────────────────

describe('parseEbayOrderPayload', () => {
  it('happy path: minimal valid payload returns narrowed shape', () => {
    const result = parseEbayOrderPayload(clone(minimalFixture))
    expect(result.orderId).toBe('13-12345-67890')
    expect(result.lineItems).toHaveLength(1)
  })

  it('throws when raw is null/undefined', () => {
    expect(() => parseEbayOrderPayload(null)).toThrow(MappingError)
    expect(() => parseEbayOrderPayload(undefined)).toThrow(MappingError)
  })

  it('throws when orderId missing', () => {
    const bad = clone(minimalFixture) as any
    delete bad.orderId
    expect(() => parseEbayOrderPayload(bad)).toThrow(/missing orderId/)
  })

  it('throws when lineItems is empty', () => {
    const bad = clone(minimalFixture) as any
    bad.lineItems = []
    expect(() => parseEbayOrderPayload(bad)).toThrow(/no lineItems/)
  })

  it('throws when fulfillmentStartInstructions is missing', () => {
    const bad = clone(minimalFixture) as any
    delete bad.fulfillmentStartInstructions
    expect(() => parseEbayOrderPayload(bad)).toThrow(/fulfillmentStartInstructions/)
  })

  it('throws when pricingSummary.total missing', () => {
    const bad = clone(minimalFixture) as any
    delete bad.pricingSummary.total
    expect(() => parseEbayOrderPayload(bad)).toThrow(/pricingSummary incomplete/)
  })
})

// ──────────────────────────────────────────────────────────────
// isInternalRedirectAddress
// ──────────────────────────────────────────────────────────────

describe('isInternalRedirectAddress', () => {
  it('detects "ebay:nlh68dw"', () => {
    expect(isInternalRedirectAddress('ebay:nlh68dw')).toBe(true)
  })

  it('case-insensitive: "EBAY:abc"', () => {
    expect(isInternalRedirectAddress('EBAY:abc')).toBe(true)
  })

  it('returns false for normal "Hauptstrasse 42"', () => {
    expect(isInternalRedirectAddress('Hauptstrasse 42')).toBe(false)
  })
})

// ──────────────────────────────────────────────────────────────
// splitFullName
// ──────────────────────────────────────────────────────────────

describe('splitFullName', () => {
  it('"Anna Becker" → firstName="Anna" lastName="Becker"', () => {
    expect(splitFullName('Anna Becker')).toEqual({ firstName: 'Anna', lastName: 'Becker' })
  })

  it('"Anna Maria Becker" → firstName="Anna Maria" lastName="Becker" (last-whitespace)', () => {
    expect(splitFullName('Anna Maria Becker')).toEqual({ firstName: 'Anna Maria', lastName: 'Becker' })
  })

  it('single-word "Anna" → firstName="Anna" lastName=""', () => {
    expect(splitFullName('Anna')).toEqual({ firstName: 'Anna', lastName: '' })
  })

  it('undefined / empty / whitespace-only → both empty', () => {
    expect(splitFullName(undefined)).toEqual({ firstName: '', lastName: '' })
    expect(splitFullName('')).toEqual({ firstName: '', lastName: '' })
    expect(splitFullName('   ')).toEqual({ firstName: '', lastName: '' })
  })
})

// ──────────────────────────────────────────────────────────────
// splitDeAddress
// ──────────────────────────────────────────────────────────────

describe('splitDeAddress — Stage 1 (simple)', () => {
  it('"Hauptstrasse 42" → street="Hauptstrasse" houseNumber="42"', () => {
    expect(splitDeAddress('Hauptstrasse 42')).toEqual({
      street: 'Hauptstrasse',
      houseNumber: '42',
    })
  })

  it('"Goethestr. 5" → street="Goethestr." houseNumber="5"', () => {
    expect(splitDeAddress('Goethestr. 5')).toEqual({
      street: 'Goethestr.',
      houseNumber: '5',
    })
  })

  it('"Allee 100" → street="Allee" houseNumber="100"', () => {
    expect(splitDeAddress('Allee 100')).toEqual({
      street: 'Allee',
      houseNumber: '100',
    })
  })
})

describe('splitDeAddress — Stage 2 (alphanumeric, range)', () => {
  it('"Goethestr. 5b" → houseNumber="5b"', () => {
    expect(splitDeAddress('Goethestr. 5b').houseNumber).toBe('5b')
  })

  it('"Berliner Str. 12-14" → houseNumber="12-14"', () => {
    expect(splitDeAddress('Berliner Str. 12-14')).toEqual({
      street: 'Berliner Str.',
      houseNumber: '12-14',
    })
  })

  it('"Allee 100/B" → houseNumber="100/B"', () => {
    expect(splitDeAddress('Allee 100/B')).toEqual({
      street: 'Allee',
      houseNumber: '100/B',
    })
  })
})

describe('splitDeAddress — Stage 3 fallback', () => {
  it('"Hauptstrasse" (no number) → houseNumber="" (empty)', () => {
    expect(splitDeAddress('Hauptstrasse')).toEqual({
      street: 'Hauptstrasse',
      houseNumber: '',
    })
  })

  it('"" (empty) → both empty', () => {
    expect(splitDeAddress('')).toEqual({ street: '', houseNumber: '' })
  })
})

// ──────────────────────────────────────────────────────────────
// buildSyntheticEmail
// ──────────────────────────────────────────────────────────────

describe('buildSyntheticEmail', () => {
  it('returns ebay-{ref}@marketplace.local', () => {
    expect(buildSyntheticEmail('anna_b_de2024')).toBe(
      'ebay-anna_b_de2024@marketplace.local',
    )
  })

  it('lowercases the ref', () => {
    expect(buildSyntheticEmail('Anna_B_DE2024')).toBe(
      'ebay-anna_b_de2024@marketplace.local',
    )
  })
})

// ──────────────────────────────────────────────────────────────
// verifyMarketplaceAndCurrency
// ──────────────────────────────────────────────────────────────

describe('verifyMarketplaceAndCurrency', () => {
  it('passes for EBAY_DE + EUR fixture', () => {
    const payload = parseEbayOrderPayload(clone(minimalFixture))
    expect(() => verifyMarketplaceAndCurrency(payload)).not.toThrow()
  })

  it('throws when listingMarketplaceId=EBAY_US', () => {
    const bad = clone(minimalFixture) as any
    bad.lineItems[0].listingMarketplaceId = 'EBAY_US'
    expect(() => verifyMarketplaceAndCurrency(bad as EbayGetOrderPayload)).toThrow(
      /listingMarketplaceId='EBAY_US'/,
    )
  })

  it('throws when total.currency=USD', () => {
    const bad = clone(minimalFixture) as any
    bad.pricingSummary.total.currency = 'USD'
    expect(() => verifyMarketplaceAndCurrency(bad as EbayGetOrderPayload)).toThrow(
      /currency='USD'/,
    )
  })
})

// ──────────────────────────────────────────────────────────────
// verifyTotalsMatch
// ──────────────────────────────────────────────────────────────

describe('verifyTotalsMatch', () => {
  it('passes when lineSum matches priceSubtotal (minimal fixture)', () => {
    const payload = parseEbayOrderPayload(clone(minimalFixture))
    expect(() => verifyTotalsMatch(payload)).not.toThrow()
  })

  it('passes for multi-line fixture (59.90 + 39.90 = 99.80)', () => {
    const payload = parseEbayOrderPayload(clone(multiLineFixture))
    expect(() => verifyTotalsMatch(payload)).not.toThrow()
  })

  it('throws when mismatch > 1 cent', () => {
    const bad = clone(minimalFixture) as any
    bad.lineItems[0].lineItemCost.value = '99.99'
    expect(() => verifyTotalsMatch(bad as EbayGetOrderPayload)).toThrow(
      /totals mismatch/,
    )
  })
})
