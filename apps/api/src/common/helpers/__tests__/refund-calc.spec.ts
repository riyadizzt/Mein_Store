/**
 * Unit tests for the proportional refund calculator.
 *
 * Coverage:
 *   - Full Return (4 scenarios): with/without coupon, with/without shipping
 *   - Partial Return (6 scenarios): including the user's original bug case
 *     (50 EUR subtotal, 25 EUR coupon, 4.99 EUR shipping, 3 of 5 items
 *     returned → 15.00 EUR refund expected, NOT 30.00 as the old code did)
 *   - Edge cases (7 scenarios): empty items, zero subtotal, zero-priced
 *     items, negative totals, rounding precision, ratio overflow,
 *     full-return with zero total
 */

import { calculateProportionalRefund } from '../refund-calc'

describe('calculateProportionalRefund', () => {
  // ─────────────────────────────────────────────────────────────
  // REGEL 1 — Full Return: refund = totalAmount (shipping included)
  // ─────────────────────────────────────────────────────────────
  describe('Full Return (isFullReturn=true)', () => {
    it('returns full totalAmount with shipping — no coupon', () => {
      // 5 × 10 = 50 subtotal, no coupon, +4.99 shipping → paid 54.99
      const r = calculateProportionalRefund({
        returnedItems: [{ unitPrice: 10, quantity: 5 }],
        order: { subtotal: 50, totalAmount: 54.99, shippingCost: 4.99 },
        isFullReturn: true,
      })
      expect(r).toBe(54.99)
    })

    it('returns full totalAmount even with coupon (shipping refunded too)', () => {
      // User's bug case — IF the customer had returned ALL 5 items:
      // 50 subtotal − 25 coupon + 4.99 shipping = 29.99 paid → full refund = 29.99
      const r = calculateProportionalRefund({
        returnedItems: [{ unitPrice: 10, quantity: 5 }],
        order: { subtotal: 50, totalAmount: 29.99, shippingCost: 4.99 },
        isFullReturn: true,
      })
      expect(r).toBe(29.99)
    })

    it('returns 0 when order was completely free (100% coupon + free shipping)', () => {
      const r = calculateProportionalRefund({
        returnedItems: [{ unitPrice: 10, quantity: 5 }],
        order: { subtotal: 50, totalAmount: 0, shippingCost: 0 },
        isFullReturn: true,
      })
      expect(r).toBe(0)
    })

    it('returns shipping-only when 100% coupon covered goods but shipping was paid', () => {
      // 50 goods − 50 coupon + 4.99 shipping = 4.99 paid → full refund = 4.99
      // Only the shipping portion flows back; there was nothing else paid.
      const r = calculateProportionalRefund({
        returnedItems: [{ unitPrice: 10, quantity: 5 }],
        order: { subtotal: 50, totalAmount: 4.99, shippingCost: 4.99 },
        isFullReturn: true,
      })
      expect(r).toBe(4.99)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // REGEL 2 — Partial Return: ratio × (totalAmount − shippingCost)
  // ─────────────────────────────────────────────────────────────
  describe('Partial Return (isFullReturn=false)', () => {
    it("user's bug case: 5-item order with 25 EUR coupon, return 3 → 15.00 EUR", () => {
      // subtotal=50, totalAmount=29.99, shipping=4.99
      // returnedSubtotal = 3 × 10 = 30
      // ratio = 30/50 = 0.6
      // paidForGoods = 29.99 − 4.99 = 25.00
      // refund = 0.6 × 25.00 = 15.00 EUR
      //
      // BEFORE FIX: old code returned 30.00 (just items sum, ignoring coupon)
      // which caused the Stripe error "amount 3000 > captured 2999"
      // and the "refunded-but-not-actually-refunded" ghost state.
      const r = calculateProportionalRefund({
        returnedItems: [{ unitPrice: 10, quantity: 3 }],
        order: { subtotal: 50, totalAmount: 29.99, shippingCost: 4.99 },
        isFullReturn: false,
      })
      expect(r).toBe(15.0)
    })

    it('no coupon, partial — returns ratio × (total − shipping)', () => {
      // 5 × 10 = 50 subtotal, no coupon, +4.99 shipping → paid 54.99
      // Return 3: ratio=0.6, paidForGoods=50, refund=30.00
      const r = calculateProportionalRefund({
        returnedItems: [{ unitPrice: 10, quantity: 3 }],
        order: { subtotal: 50, totalAmount: 54.99, shippingCost: 4.99 },
        isFullReturn: false,
      })
      expect(r).toBe(30.0)
    })

    it('free shipping — partial refund is ratio × totalAmount', () => {
      // Free shipping → paidForGoods === totalAmount, formula unchanged
      // 50 subtotal, 25 total (half off), 0 shipping → return 2 items = 20
      // ratio = 20/50 = 0.4, paidForGoods = 25, refund = 10
      const r = calculateProportionalRefund({
        returnedItems: [{ unitPrice: 10, quantity: 2 }],
        order: { subtotal: 50, totalAmount: 25, shippingCost: 0 },
        isFullReturn: false,
      })
      expect(r).toBe(10.0)
    })

    it('100% coupon with paid shipping → partial refund = 0', () => {
      // Customer paid only shipping. Partial return: goods portion is 0 →
      // nothing to refund. Shipping doesn't come back on partial — stays
      // with shop. Full Return handles this differently (see test above).
      const r = calculateProportionalRefund({
        returnedItems: [{ unitPrice: 10, quantity: 2 }],
        order: { subtotal: 50, totalAmount: 4.99, shippingCost: 4.99 },
        isFullReturn: false,
      })
      expect(r).toBe(0)
    })

    it('mixed item prices — uses the correct weighted sum', () => {
      // 2 × 30 + 1 × 20 = 80 returned subtotal out of 120 order subtotal
      // ratio = 80/120 = 0.6666...
      // paidForGoods = 100 − 5 = 95
      // refund = 0.6666... × 95 = 63.333... → round to 63.33
      const r = calculateProportionalRefund({
        returnedItems: [
          { unitPrice: 30, quantity: 2 },
          { unitPrice: 20, quantity: 1 },
        ],
        order: { subtotal: 120, totalAmount: 100, shippingCost: 5 },
        isFullReturn: false,
      })
      expect(r).toBe(63.33)
    })

    it('ratio cap at 1.0 — returnedSubtotal > subtotal (defensive)', () => {
      // Shouldn't happen with clean data, but if it does we never
      // refund more than the paid-for-goods.
      const r = calculateProportionalRefund({
        returnedItems: [{ unitPrice: 100, quantity: 1 }],
        order: { subtotal: 50, totalAmount: 45, shippingCost: 0 },
        isFullReturn: false,
      })
      // ratio would be 2.0 → capped to 1.0 → refund = 45
      expect(r).toBe(45)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Edge cases + defensive safety
  // ─────────────────────────────────────────────────────────────
  describe('Edge cases', () => {
    it('empty returnedItems array → 0', () => {
      const r = calculateProportionalRefund({
        returnedItems: [],
        order: { subtotal: 50, totalAmount: 54.99, shippingCost: 4.99 },
        isFullReturn: false,
      })
      expect(r).toBe(0)
    })

    it('order subtotal = 0 (defensive, shouldn\'t happen) → 0', () => {
      const r = calculateProportionalRefund({
        returnedItems: [{ unitPrice: 10, quantity: 1 }],
        order: { subtotal: 0, totalAmount: 10, shippingCost: 0 },
        isFullReturn: false,
      })
      expect(r).toBe(0)
    })

    it('returnedItems with zero unit prices → 0', () => {
      // E.g. a gift line with unitPrice=0. Nothing to refund.
      const r = calculateProportionalRefund({
        returnedItems: [{ unitPrice: 0, quantity: 3 }],
        order: { subtotal: 50, totalAmount: 50, shippingCost: 0 },
        isFullReturn: false,
      })
      expect(r).toBe(0)
    })

    it('negative totalAmount (data corruption guard) → 0', () => {
      // paidForGoods clamps to max(0, negative − 0) = 0
      const r = calculateProportionalRefund({
        returnedItems: [{ unitPrice: 10, quantity: 1 }],
        order: { subtotal: 50, totalAmount: -5, shippingCost: 0 },
        isFullReturn: false,
      })
      expect(r).toBe(0)
    })

    it('rounds to 2 decimals — typical non-terminating case', () => {
      // returnedSubtotal = 10.99, subtotal = 27 → ratio = 0.40703...
      // paidForGoods = 45, refund = 18.316... → 18.32
      const r = calculateProportionalRefund({
        returnedItems: [{ unitPrice: 10.99, quantity: 1 }],
        order: { subtotal: 27, totalAmount: 45, shippingCost: 0 },
        isFullReturn: false,
      })
      expect(r).toBe(18.32)
    })

    it('rounds .5 up (Math.round behavior, banker-safe via integer cents)', () => {
      // 1/2 × 0.25 = 0.125 → 12.5 cents → Math.round → 13 → 0.13
      const r = calculateProportionalRefund({
        returnedItems: [{ unitPrice: 1, quantity: 1 }],
        order: { subtotal: 2, totalAmount: 0.25, shippingCost: 0 },
        isFullReturn: false,
      })
      expect(r).toBe(0.13)
    })

    it('full return with totalAmount = 0 → 0 (not negative)', () => {
      // Defensive — Math.max guards against negative outputs.
      const r = calculateProportionalRefund({
        returnedItems: [{ unitPrice: 10, quantity: 5 }],
        order: { subtotal: 50, totalAmount: 0, shippingCost: 0 },
        isFullReturn: true,
      })
      expect(r).toBe(0)
    })
  })
})
