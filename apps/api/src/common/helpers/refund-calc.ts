/**
 * Proportional refund calculator for returns + partial cancellations.
 *
 * Business rules (Malak Bekleidung):
 *
 *   REGEL 1 — Full Return/Cancel:
 *     isFullReturn=true → refund = order.totalAmount
 *     Customer gets everything back INCLUDING the shipping cost. This
 *     branch is entered only when the service layer has confirmed that
 *     (a) the current return covers ALL items of the order in full
 *     quantity AND (b) no prior PROCESSED refund exists for this order.
 *
 *   REGEL 2 — Partial Return:
 *     isFullReturn=false → refund = ratio × (totalAmount − shippingCost)
 *     Customer gets a proportional share of the AFTER-COUPON amount for
 *     the goods only. Shipping stays with the shop because it was a real
 *     cost to DHL and can't be un-paid on a partial.
 *
 *     ratio = Σ (unitPrice × quantity of returned items) / order.subtotal
 *
 * Single-refund-per-order assumption:
 *   Malak Bekleidung does not support multiple separate refunds for the
 *   same order. The customer opens the package once, decides once. The
 *   service-layer's existing "has PROCESSED refund?" guard catches any
 *   edge case, so this helper doesn't need to track prior-refund-total.
 *
 * Rounding + defensive safety:
 *   - Output always rounded to 2 decimals via integer-cents Math.round
 *     (avoids floating-point drift like 15.000000000002).
 *   - Never returns a negative number.
 *   - Gracefully handles empty items / zero subtotal / negative totals
 *     by returning 0 (bad input shouldn't produce bad refunds).
 *   - Ratio capped at 1.0 so a malformed input where returnedSubtotal
 *     exceeds order.subtotal can never over-refund.
 */

export interface RefundCalcInput {
  /** Line items included in the current return. */
  returnedItems: Array<{ unitPrice: number; quantity: number }>
  /** Order financials (all brutto, MwSt included per German convention). */
  order: {
    /** Gross subtotal — sum of item prices BEFORE coupon. */
    subtotal: number
    /** What the customer actually paid (after coupon, + shipping, incl. tax). */
    totalAmount: number
    /** Shipping portion (stays with shop on partial returns). */
    shippingCost: number
  }
  /**
   * Full Return flag. Set true by the service layer when:
   *   1. The current return covers ALL order items with matching
   *      quantities (variantId-exact match), AND
   *   2. No prior PROCESSED refund exists for the same order.
   * The helper trusts this flag — all detection logic lives in the service.
   */
  isFullReturn: boolean
}

/**
 * Round to 2 decimal places via integer cents. This is the standard
 * money-safe rounding: x → round(x * 100) / 100.
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function calculateProportionalRefund(input: RefundCalcInput): number {
  const { returnedItems, order, isFullReturn } = input

  const totalAmount = Number(order.totalAmount)
  const shippingCost = Number(order.shippingCost)
  const subtotal = Number(order.subtotal)

  // REGEL 1 — Full Return: customer paid X, we return X.
  if (isFullReturn) {
    return round2(Math.max(0, totalAmount))
  }

  // REGEL 2 — Partial Return
  if (!returnedItems || returnedItems.length === 0) return 0
  if (subtotal <= 0) return 0

  const returnedSubtotal = returnedItems.reduce(
    (s, it) => s + Number(it.unitPrice) * Number(it.quantity),
    0,
  )
  if (returnedSubtotal <= 0) return 0

  // Ratio of returned items against the original subtotal. Cap at 1.0
  // defensively — returnedSubtotal shouldn't exceed subtotal with clean
  // data, but if it does we never refund more than the paid-for-goods.
  const ratio = Math.min(returnedSubtotal / subtotal, 1)

  // What the customer paid for the GOODS (excluding shipping). Shipping
  // cost is what we paid to DHL and stays with the shop on partials.
  const paidForGoods = Math.max(0, totalAmount - shippingCost)

  const refund = ratio * paidForGoods

  return round2(Math.max(0, refund))
}
