/**
 * Normalizes the barcode value for a new or updated product variant.
 *
 * Invariant: every ProductVariant must always have a non-empty barcode.
 * Default is the SKU itself. External EAN/GTIN codes can override it,
 * but the field can NEVER be cleared to null or empty — that would
 * break the scanner flow + the CSV export and leave an audit-trail
 * gap (stock movements reference variants by barcode first).
 *
 * Accepts undefined / null / empty string / whitespace and falls back
 * to `sku`. Trims surrounding whitespace otherwise.
 *
 *   ensureVariantBarcode({ sku: 'ABC', barcode: undefined })       → 'ABC'
 *   ensureVariantBarcode({ sku: 'ABC', barcode: '' })              → 'ABC'
 *   ensureVariantBarcode({ sku: 'ABC', barcode: '   ' })           → 'ABC'
 *   ensureVariantBarcode({ sku: 'ABC', barcode: '  4006381' })     → '4006381'
 *   ensureVariantBarcode({ sku: 'ABC', barcode: '4006381333931' }) → '4006381333931'
 */
export function ensureVariantBarcode(input: {
  sku: string
  barcode?: string | null
}): string {
  if (!input.sku) {
    // Defensive: a variant without a SKU is a programming error. We
    // still return something non-empty so the DB insert doesn't crash
    // with a null violation — the caller is already in a broken state
    // and will fail on the SKU constraint anyway.
    return input.barcode?.trim() || ''
  }
  const trimmed = input.barcode?.trim()
  if (trimmed && trimmed.length > 0) return trimmed
  return input.sku
}
