/**
 * C15.6 — EbaySnapshotVerifier (full impl, Block 2).
 *
 * Pre/Post-PUT Diff-Verifier für Strategy B (GetThenPutStrategy).
 * Verifiziert dass das PUT NICHT andere Felder als quantity verändert
 * hat (Replace-vs-Merge-Flaw-Mitigation).
 *
 * PRESERVE_FIELDS Liste: alle Felder die NICHT durch C15.6-quantity-update
 * geändert werden sollen. Wenn eines davon nach PUT verschwunden / verändert
 * ist → dataLossDetected = true → Strategy.execute returnt ok=false +
 * Selector versucht next strategy + Audit-event CHANNEL_LISTING_DATA_DRIFT_DETECTED.
 */

import { Injectable } from '@nestjs/common'

/**
 * Felder die NACH PUT inventory_item identisch zu vorher sein müssen.
 * eBay's createOrReplaceInventoryItem-Endpoint heißt namentlich "Replace"
 * — bei minimal-PUT-body würden alle nicht-genannten Felder auf Defaults
 * resetted. Strategy B nutzt full-spread-pattern um das zu verhindern;
 * Verifier bestätigt es empirisch.
 *
 * Path-Notation: dot-separated für nested fields (z.B. 'product.title').
 * groupIds + inventoryItemGroupKeys sind kritisch für Multi-Variation-
 * Listings (siehe C15.5 H4-Befund + Risk #10 PLAN.md v3).
 */
const PRESERVE_FIELDS = [
  'product.title',
  'product.description',
  'product.aspects',
  'product.imageUrls',
  'product.brand',
  'product.mpn',
  'product.ean',
  'condition',
  'packageWeightAndSize.weight',
  'packageWeightAndSize.dimensions',
  'packageWeightAndSize.shippingIrregular',
  'groupIds',
  'inventoryItemGroupKeys',
  'locale',
] as const

export interface SnapshotDiff {
  /** True wenn mindestens ein PRESERVE_FIELD zwischen pre und post unterschiedlich. */
  dataLossDetected: boolean
  /** Liste der PRESERVE_FIELDS die geändert wurden (z.B. ['product.title']). */
  changedFields: string[]
  /** True wenn post.availability.shipToLocationAvailability.quantity === expected. */
  quantityCorrect: boolean
}

@Injectable()
export class EbaySnapshotVerifier {
  /**
   * Diff zwei Snapshots gegen die PRESERVE_FIELDS-Liste.
   *
   * @param pre Snapshot vor PUT (von GET inventory_item)
   * @param post Snapshot nach PUT (von verify-GET inventory_item)
   * @param expectedQty Die quantity die im PUT body gesendet wurde
   */
  diff(pre: any, post: any, expectedQty: number): SnapshotDiff {
    const changedFields: string[] = []

    for (const path of PRESERVE_FIELDS) {
      const a = this.getPath(pre, path)
      const b = this.getPath(post, path)
      if (!this.deepEqual(a, b)) {
        changedFields.push(path)
      }
    }

    const postQty = this.getPath(post, 'availability.shipToLocationAvailability.quantity')

    return {
      dataLossDetected: changedFields.length > 0,
      changedFields,
      quantityCorrect: postQty === expectedQty,
    }
  }

  /**
   * Resolves dot-separated path in nested object. Returns undefined wenn
   * irgendeine Stufe missing.
   */
  private getPath(obj: any, path: string): any {
    if (obj == null) return undefined
    const segments = path.split('.')
    let current: any = obj
    for (const seg of segments) {
      if (current == null) return undefined
      current = current[seg]
    }
    return current
  }

  /**
   * Deep-Equal für Snapshot-Diff. Handles:
   *   - Primitives (string, number, boolean, null, undefined)
   *   - Arrays (order-sensitive)
   *   - Plain objects (key-by-key comparison)
   *
   * NOT supported: Date, Map, Set, RegExp, functions — eBay-API-Responses
   * enthalten nur JSON-shaped data, daher ausreichend.
   */
  private deepEqual(a: any, b: any): boolean {
    if (a === b) return true
    if (a == null || b == null) return a === b
    if (typeof a !== typeof b) return false
    if (typeof a !== 'object') return a === b
    if (Array.isArray(a)) {
      if (!Array.isArray(b)) return false
      if (a.length !== b.length) return false
      for (let i = 0; i < a.length; i++) {
        if (!this.deepEqual(a[i], b[i])) return false
      }
      return true
    }
    if (Array.isArray(b)) return false
    const ak = Object.keys(a).sort()
    const bk = Object.keys(b).sort()
    if (ak.length !== bk.length) return false
    for (let i = 0; i < ak.length; i++) {
      if (ak[i] !== bk[i]) return false
      if (!this.deepEqual(a[ak[i]], b[bk[i]])) return false
    }
    return true
  }
}
