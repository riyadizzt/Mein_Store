// Canonical size sorter — mirrors apps/api/src/modules/products/products.service.ts.
//
// Order:
//   1. Numeric sizes ascending (2, 3, 34, 36, 164, ...)
//   2. Letter sizes in clothing order (XXS → XS → S → M → L → XL → XXL → 3XL → ...)
//   3. Anything else alphabetical at the end (typos like "4XI", custom labels)

const LETTER_SIZE_ORDER: Record<string, number> = {
  XXXS: 0, '3XS': 0,
  XXS: 1, '2XS': 1,
  XS: 2,
  S: 3,
  M: 4,
  L: 5,
  XL: 6,
  XXL: 7, '2XL': 7,
  XXXL: 8, '3XL': 8,
  XXXXL: 9, '4XL': 9,
  '5XL': 10,
  '6XL': 11,
  '7XL': 12,
}

export function compareSizes(a: string, b: string): number {
  const aTrim = a.trim()
  const bTrim = b.trim()

  const aIsNum = /^\d+(\.\d+)?$/.test(aTrim)
  const bIsNum = /^\d+(\.\d+)?$/.test(bTrim)
  if (aIsNum && bIsNum) return parseFloat(aTrim) - parseFloat(bTrim)
  if (aIsNum) return -1
  if (bIsNum) return 1

  const aRank = LETTER_SIZE_ORDER[aTrim.toUpperCase()]
  const bRank = LETTER_SIZE_ORDER[bTrim.toUpperCase()]
  if (aRank !== undefined && bRank !== undefined) return aRank - bRank
  if (aRank !== undefined) return -1
  if (bRank !== undefined) return 1

  return aTrim.localeCompare(bTrim)
}
