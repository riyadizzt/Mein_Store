import { ensureVariantBarcode } from '../variant-barcode'

describe('ensureVariantBarcode', () => {
  it('returns SKU when barcode is undefined', () => {
    expect(ensureVariantBarcode({ sku: 'ABC-123' })).toBe('ABC-123')
  })

  it('returns SKU when barcode is null', () => {
    expect(ensureVariantBarcode({ sku: 'ABC-123', barcode: null })).toBe('ABC-123')
  })

  it('returns SKU when barcode is empty string', () => {
    expect(ensureVariantBarcode({ sku: 'ABC-123', barcode: '' })).toBe('ABC-123')
  })

  it('returns SKU when barcode is whitespace only', () => {
    expect(ensureVariantBarcode({ sku: 'ABC-123', barcode: '   ' })).toBe('ABC-123')
    expect(ensureVariantBarcode({ sku: 'ABC-123', barcode: '\t\n' })).toBe('ABC-123')
  })

  it('returns the provided barcode when valid', () => {
    expect(ensureVariantBarcode({ sku: 'ABC-123', barcode: '4006381333931' })).toBe('4006381333931')
  })

  it('trims whitespace from a valid barcode', () => {
    expect(ensureVariantBarcode({ sku: 'ABC-123', barcode: '  4006381  ' })).toBe('4006381')
  })

  it('barcode is NEVER returned as empty/null', () => {
    // Fuzz the common broken inputs from the real code paths we saw.
    const inputs: Array<string | null | undefined> = [undefined, null, '', ' ', '\n', '\t']
    for (const barcode of inputs) {
      const result = ensureVariantBarcode({ sku: 'MAL-001', barcode })
      expect(result).toBeTruthy()
      expect(result.length).toBeGreaterThan(0)
      expect(result).toBe('MAL-001')
    }
  })

  it('defensive: returns empty string if SKU is missing (programming error)', () => {
    // Callers should never hit this — but we don't want the helper to
    // crash and leave the caller with an unhandled TypeError.
    expect(ensureVariantBarcode({ sku: '', barcode: undefined })).toBe('')
    expect(ensureVariantBarcode({ sku: '', barcode: 'fallback' })).toBe('fallback')
  })
})
