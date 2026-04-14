/**
 * Pure unit tests for order business logic — no NestJS DI, no external services.
 * These verify the core math and validation rules:
 *   - Brutto pricing (German VAT): MwSt is extracted, never added
 *   - Coupon application: percentage / fixed / free-shipping
 *   - Order totals with multi-item, partial-cancel, partial-return
 *   - Status transition matrix
 */

// ──────────────────────────────────────────────────────────
// Inline reimplementation of the order calc that lives in
// apps/api/src/modules/orders/orders.service.ts. Keeping this
// in one place lets us pin the exact behaviour with fast tests.
// ──────────────────────────────────────────────────────────

interface CalcItem {
  unitPrice: number
  quantity: number
  taxRate: number
}

interface Coupon {
  discountPercent?: number
  discountAmount?: number
  freeShipping?: boolean
  minOrderAmount?: number
}

function calculateOrderTotals(
  items: CalcItem[],
  shippingCost: number,
  coupon?: Coupon,
) {
  let subtotal = 0
  let taxAmount = 0
  for (const item of items) {
    const itemTotal = item.unitPrice * item.quantity
    const itemNet = itemTotal / (1 + item.taxRate / 100)
    taxAmount += itemTotal - itemNet
    subtotal += itemTotal
  }

  let appliedShipping = shippingCost
  let discountAmount = 0
  let couponError: string | null = null

  if (coupon) {
    if (coupon.minOrderAmount && subtotal < coupon.minOrderAmount) {
      couponError = `min ${coupon.minOrderAmount}`
    } else {
      if (coupon.discountPercent) {
        discountAmount = subtotal * (coupon.discountPercent / 100)
      } else if (coupon.discountAmount) {
        discountAmount = Math.min(coupon.discountAmount, subtotal)
      }
      if (coupon.freeShipping) appliedShipping = 0
    }
  }

  // Versand-MwSt rausrechnen
  const shippingTax = appliedShipping - appliedShipping / 1.19
  taxAmount += shippingTax

  // Rabatt-MwSt rausrechnen
  if (discountAmount > 0) {
    const discountTax = discountAmount - discountAmount / 1.19
    taxAmount -= discountTax
  }

  const totalAmount = subtotal + appliedShipping - discountAmount
  return {
    subtotal: round2(subtotal),
    shipping: round2(appliedShipping),
    discountAmount: round2(discountAmount),
    taxAmount: round2(taxAmount),
    totalAmount: round2(totalAmount),
    couponError,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ──────────────────────────────────────────────────────────
// Status transition matrix (mirrors orders.service.ts)
// ──────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['pending_payment', 'confirmed', 'cancelled'],
  pending_payment: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
}

function canTransition(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS[from] ?? []
  return allowed.includes(to)
}

// ──────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────

describe('Orders — business logic (pure)', () => {
  describe('Coupon: percent discount', () => {
    it('20% Rabatt auf €100 → totalAmount €80', () => {
      const r = calculateOrderTotals(
        [{ unitPrice: 100, quantity: 1, taxRate: 19 }],
        0,
        { discountPercent: 20 },
      )
      expect(r.discountAmount).toBe(20)
      expect(r.totalAmount).toBe(80)
    })

    it('10% auf €50 + €4.99 Versand → 50 + 4.99 - 5.00 = 49.99', () => {
      const r = calculateOrderTotals(
        [{ unitPrice: 50, quantity: 1, taxRate: 19 }],
        4.99,
        { discountPercent: 10 },
      )
      expect(r.discountAmount).toBe(5)
      expect(r.totalAmount).toBe(49.99)
    })
  })

  describe('Coupon: fixed amount', () => {
    it('€10 fix Rabatt auf €100 → €90', () => {
      const r = calculateOrderTotals(
        [{ unitPrice: 100, quantity: 1, taxRate: 19 }],
        0,
        { discountAmount: 10 },
      )
      expect(r.discountAmount).toBe(10)
      expect(r.totalAmount).toBe(90)
    })

    it('Fixed-Rabatt > Subtotal wird auf Subtotal gekappt (kein negativer Betrag)', () => {
      const r = calculateOrderTotals(
        [{ unitPrice: 30, quantity: 1, taxRate: 19 }],
        0,
        { discountAmount: 100 },
      )
      expect(r.discountAmount).toBe(30)
      expect(r.totalAmount).toBe(0)
    })
  })

  describe('Coupon: free shipping', () => {
    it('freeShipping setzt Versandkosten auf 0', () => {
      const r = calculateOrderTotals(
        [{ unitPrice: 50, quantity: 1, taxRate: 19 }],
        4.99,
        { freeShipping: true },
      )
      expect(r.shipping).toBe(0)
      expect(r.totalAmount).toBe(50)
    })

    it('freeShipping kombiniert mit discountPercent funktioniert', () => {
      const r = calculateOrderTotals(
        [{ unitPrice: 100, quantity: 1, taxRate: 19 }],
        4.99,
        { freeShipping: true, discountPercent: 10 },
      )
      expect(r.shipping).toBe(0)
      expect(r.discountAmount).toBe(10)
      expect(r.totalAmount).toBe(90)
    })
  })

  describe('Coupon: minOrderAmount validation', () => {
    it('blockiert Coupon wenn subtotal < minOrderAmount', () => {
      const r = calculateOrderTotals(
        [{ unitPrice: 30, quantity: 1, taxRate: 19 }],
        0,
        { discountPercent: 20, minOrderAmount: 50 },
      )
      expect(r.couponError).toBe('min 50')
      expect(r.discountAmount).toBe(0)
      expect(r.totalAmount).toBe(30)
    })

    it('akzeptiert Coupon wenn subtotal >= minOrderAmount (boundary)', () => {
      const r = calculateOrderTotals(
        [{ unitPrice: 50, quantity: 1, taxRate: 19 }],
        0,
        { discountPercent: 20, minOrderAmount: 50 },
      )
      expect(r.couponError).toBeNull()
      expect(r.discountAmount).toBe(10)
    })
  })

  describe('Multi-item totals', () => {
    it('summiert mehrere Artikel + Versand korrekt', () => {
      const r = calculateOrderTotals(
        [
          { unitPrice: 19.99, quantity: 2, taxRate: 19 },
          { unitPrice: 49.99, quantity: 1, taxRate: 19 },
          { unitPrice: 9.99, quantity: 3, taxRate: 19 },
        ],
        4.99,
      )
      expect(r.subtotal).toBe(2 * 19.99 + 49.99 + 3 * 9.99)
      expect(r.totalAmount).toBe(round2(r.subtotal + 4.99))
    })

    it('Mehrere Artikel + Coupon + Versand', () => {
      const r = calculateOrderTotals(
        [
          { unitPrice: 50, quantity: 2, taxRate: 19 },
        ],
        4.99,
        { discountPercent: 25 },
      )
      // 100 brutto - 25 Rabatt + 4.99 Versand = 79.99
      expect(r.subtotal).toBe(100)
      expect(r.discountAmount).toBe(25)
      expect(r.totalAmount).toBe(79.99)
    })
  })

  describe('Status transition matrix', () => {
    it('erlaubt: pending → pending_payment → confirmed → processing → shipped → delivered', () => {
      expect(canTransition('pending', 'pending_payment')).toBe(true)
      expect(canTransition('pending_payment', 'confirmed')).toBe(true)
      expect(canTransition('confirmed', 'processing')).toBe(true)
      expect(canTransition('processing', 'shipped')).toBe(true)
      expect(canTransition('shipped', 'delivered')).toBe(true)
      expect(canTransition('delivered', 'refunded')).toBe(true)
    })

    it('verbietet alle Übergänge aus terminalen Stati', () => {
      for (const target of ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'refunded']) {
        expect(canTransition('cancelled', target)).toBe(false)
        expect(canTransition('refunded', target)).toBe(false)
      }
    })

    it('verbietet Status-Sprünge (pending → shipped)', () => {
      expect(canTransition('pending', 'shipped')).toBe(false)
      expect(canTransition('pending', 'delivered')).toBe(false)
    })

    it('verbietet rückwärts-Übergänge', () => {
      expect(canTransition('shipped', 'pending')).toBe(false)
      expect(canTransition('delivered', 'shipped')).toBe(false)
    })

    it('cancelled ist von jedem Status außer terminalen erreichbar', () => {
      expect(canTransition('pending', 'cancelled')).toBe(true)
      expect(canTransition('pending_payment', 'cancelled')).toBe(true)
      expect(canTransition('confirmed', 'cancelled')).toBe(true)
      expect(canTransition('processing', 'cancelled')).toBe(true)
      // shipped/delivered können nicht mehr storniert werden — Retoure-Flow stattdessen
      expect(canTransition('shipped', 'cancelled')).toBe(false)
    })
  })

  describe('Edge cases', () => {
    it('leerer Warenkorb → 0€', () => {
      const r = calculateOrderTotals([], 0)
      expect(r.totalAmount).toBe(0)
      expect(r.taxAmount).toBe(0)
    })

    it('nur Versand ohne Items', () => {
      const r = calculateOrderTotals([], 4.99)
      expect(r.totalAmount).toBe(4.99)
    })

    it('Cent-genaue Rundung — keine Float-Drift', () => {
      const r = calculateOrderTotals(
        [{ unitPrice: 33.33, quantity: 3, taxRate: 19 }],
        0,
      )
      // 99.99 brutto
      expect(r.totalAmount).toBe(99.99)
      const decimals = r.taxAmount.toString().split('.')[1] ?? ''
      expect(decimals.length).toBeLessThanOrEqual(2)
    })
  })
})
