/**
 * C15.6 Tests — EbaySnapshotVerifier.
 *
 * Coverage:
 *  - dataLossDetected=false on field preservation (full match)
 *  - dataLossDetected=true on field loss (title removed)
 *  - Multi-Variation groupIds preservation (Risk #10)
 *  - Quantity correctness check
 */

import { EbaySnapshotVerifier } from '../ebay-snapshot-verifier'

const FULL_PRESERVED_SNAPSHOT = {
  sku: 'MAL-TEST',
  locale: 'de_DE',
  groupIds: ['MAL_group-1'],
  inventoryItemGroupKeys: ['MAL_group-1'],
  product: {
    title: 'Herren Schuhe',
    description: 'Schwarz, Echtleder',
    aspects: { Marke: ['Malak'], Farbe: ['Schwarz'] },
    imageUrls: ['https://cdn/img-1.jpg'],
    brand: 'Malak Bekleidung',
    mpn: 'MAL-TEST',
    ean: ['Does not apply'],
  },
  condition: 'NEW',
  packageWeightAndSize: {
    weight: { value: 500, unit: 'GRAM' },
    dimensions: undefined,
    shippingIrregular: false,
  },
  availability: {
    shipToLocationAvailability: { quantity: 5 },
  },
}

describe('EbaySnapshotVerifier', () => {
  let verifier: EbaySnapshotVerifier

  beforeEach(() => {
    verifier = new EbaySnapshotVerifier()
  })

  it('dataLossDetected=false on full preservation (only quantity changed)', () => {
    const pre = JSON.parse(JSON.stringify(FULL_PRESERVED_SNAPSHOT))
    const post = JSON.parse(JSON.stringify(FULL_PRESERVED_SNAPSHOT))
    post.availability.shipToLocationAvailability.quantity = 7

    const diff = verifier.diff(pre, post, 7)

    expect(diff.dataLossDetected).toBe(false)
    expect(diff.changedFields).toEqual([])
    expect(diff.quantityCorrect).toBe(true)
  })

  it('dataLossDetected=true when product.title is removed (Replace-vs-Merge-Flaw)', () => {
    const pre = JSON.parse(JSON.stringify(FULL_PRESERVED_SNAPSHOT))
    const post = JSON.parse(JSON.stringify(FULL_PRESERVED_SNAPSHOT))
    delete post.product.title // simulate eBay Replace-semantic
    post.availability.shipToLocationAvailability.quantity = 7

    const diff = verifier.diff(pre, post, 7)

    expect(diff.dataLossDetected).toBe(true)
    expect(diff.changedFields).toContain('product.title')
    expect(diff.quantityCorrect).toBe(true)
  })

  it('detects groupIds drift (Multi-Variation Risk #10)', () => {
    const pre = JSON.parse(JSON.stringify(FULL_PRESERVED_SNAPSHOT))
    const post = JSON.parse(JSON.stringify(FULL_PRESERVED_SNAPSHOT))
    post.groupIds = [] // SKU dropped from group
    post.availability.shipToLocationAvailability.quantity = 7

    const diff = verifier.diff(pre, post, 7)

    expect(diff.dataLossDetected).toBe(true)
    expect(diff.changedFields).toContain('groupIds')
  })

  it('quantityCorrect=false when post-quantity differs from expected', () => {
    const pre = JSON.parse(JSON.stringify(FULL_PRESERVED_SNAPSHOT))
    const post = JSON.parse(JSON.stringify(FULL_PRESERVED_SNAPSHOT))
    post.availability.shipToLocationAvailability.quantity = 99 // mismatch

    const diff = verifier.diff(pre, post, 7)

    expect(diff.dataLossDetected).toBe(false)
    expect(diff.quantityCorrect).toBe(false)
  })

  it('detects deeply-nested aspects drift', () => {
    const pre = JSON.parse(JSON.stringify(FULL_PRESERVED_SNAPSHOT))
    const post = JSON.parse(JSON.stringify(FULL_PRESERVED_SNAPSHOT))
    post.product.aspects.Farbe = ['Weiß'] // changed
    post.availability.shipToLocationAvailability.quantity = 7

    const diff = verifier.diff(pre, post, 7)

    expect(diff.dataLossDetected).toBe(true)
    expect(diff.changedFields).toContain('product.aspects')
  })
})
