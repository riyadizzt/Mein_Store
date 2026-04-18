/**
 * Rehydrate-time coupon re-validator.
 *
 * Runs after the checkout-store rehydrates from sessionStorage. If a
 * couponCode survived the rehydrate, the derived appliedCoupon object
 * and discountAmount did NOT (by design in partialize). We recompute
 * them by calling /coupons/validate with the current cart subtotal.
 *
 * Success  → setCoupon() restores the full triple (code, coupon, discount).
 * Reject   → removeCoupon() + warning toast with the server's reason.
 * Network  → optimistic keep (couponCode stays, no toast). Backend
 *            order-create is the final authority with 400 CouponRejected.
 *
 * The module is imported dynamically from checkout-store's
 * onRehydrateStorage to avoid an evaluation cycle:
 *   checkout-store → coupon-revalidator → api.ts → useAuthStore
 * (api.ts reads the auth store at request time; keeping the import
 * dynamic means the revalidator is resolved only AFTER all stores
 * have finished their module-evaluation bootstrap.)
 */

import { api } from './api'
import { useCheckoutStore } from '@/store/checkout-store'
import { useCartStore } from '@/store/cart-store'
import { toast } from '@/store/toast-store'

// Coarse locale detection for the toast message. The onRehydrateStorage
// hook fires before next-intl's React context is available, so we read
// the URL prefix directly. Safe fallback to 'de'.
function detectLocale(): 'de' | 'en' | 'ar' {
  if (typeof window === 'undefined') return 'de'
  const first = window.location.pathname.split('/')[1]
  if (first === 'en' || first === 'ar' || first === 'de') return first
  return 'de'
}

export async function revalidateCouponOnRehydrate(code: string): Promise<void> {
  const locale = detectLocale()
  const cart = useCartStore.getState()
  const subtotal = typeof cart.subtotal === 'function' ? cart.subtotal() : 0

  try {
    const { data } = await api.post('/coupons/validate', { code, subtotal })

    if (data?.valid === true && data.coupon) {
      const c = data.coupon
      let discount = 0
      if (c.type === 'percentage' && c.discountPercent) {
        discount = subtotal * (c.discountPercent / 100)
      } else if (c.type === 'fixed_amount' && c.discountAmount) {
        discount = Math.min(c.discountAmount, subtotal)
      }
      // free_shipping → discount stays 0; shipping is zeroed elsewhere
      useCheckoutStore.getState().setCoupon(
        c.code,
        c,
        Math.round(discount * 100) / 100,
      )
      return
    }

    // valid === false → server rejected the coupon (expired, one_per_customer,
    // min_order, not_active, etc.). Drop from store + notify the user.
    useCheckoutStore.getState().removeCoupon()
    const reason = data?.reason
    const localized =
      typeof reason === 'object' && reason
        ? (reason[locale] ?? reason.de ?? reason.en ?? '')
        : typeof reason === 'string'
          ? reason
          : ''
    const prefix =
      locale === 'ar' ? 'تمت إزالة القسيمة'
      : locale === 'en' ? 'Coupon removed'
      : 'Gutschein entfernt'
    toast.error(localized ? `${prefix}: ${localized}` : prefix)
  } catch {
    // Network / 5xx → optimistic keep. Do NOT clear the code; backend
    // order-create will reject with 400 CouponRejected if truly invalid.
    // No toast either — offline users should not see a scary banner.
  }
}
