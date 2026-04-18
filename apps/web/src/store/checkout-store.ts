import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export interface CheckoutAddress {
  firstName: string
  lastName: string
  street: string
  houseNumber: string
  addressLine2?: string
  postalCode: string
  city: string
  country: string
  company?: string
}

export interface ShippingOption {
  id: string
  name: string
  price: number
  estimatedDelivery: string
  carrier: string
}

type CheckoutStep = 'guest' | 'address' | 'shipping' | 'payment' | 'confirmation'
type PaymentMethod = 'stripe_card' | 'klarna_pay_now' | 'klarna_pay_later' | 'klarna_installments' | 'paypal' | 'apple_pay' | 'google_pay'

interface CheckoutState {
  step: CheckoutStep
  isGuest: boolean
  guestEmail: string

  shippingAddress: CheckoutAddress | null
  billingAddress: CheckoutAddress | null
  billingSameAsShipping: boolean
  savedAddressId: string | null

  shippingOption: ShippingOption | null
  paymentMethod: PaymentMethod | null

  couponCode: string | null
  appliedCoupon: { code: string; type: string; discountPercent: number | null; discountAmount: number | null; freeShipping: boolean; description: string | null } | null
  discountAmount: number

  termsAccepted: boolean
  orderId: string | null
  orderNumber: string | null
  idempotencyKey: string | null
  isProcessing: boolean
  error: string | null

  setStep: (step: CheckoutStep) => void
  setGuest: (isGuest: boolean, email?: string) => void
  setShippingAddress: (address: CheckoutAddress) => void
  setBillingAddress: (address: CheckoutAddress | null) => void
  setBillingSameAsShipping: (same: boolean) => void
  setSavedAddressId: (id: string | null) => void
  setShippingOption: (option: ShippingOption) => void
  setPaymentMethod: (method: PaymentMethod) => void
  setCoupon: (code: string, coupon: CheckoutState['appliedCoupon'], discount: number) => void
  removeCoupon: () => void
  setTermsAccepted: (accepted: boolean) => void
  setOrder: (orderId: string, orderNumber: string) => void
  setProcessing: (processing: boolean) => void
  setError: (error: string | null) => void
  generateIdempotencyKey: () => string
  reset: () => void
}

const initialState = {
  step: 'guest' as CheckoutStep,
  isGuest: false,
  guestEmail: '',
  shippingAddress: null,
  billingAddress: null,
  billingSameAsShipping: true,
  savedAddressId: null,
  shippingOption: null,
  paymentMethod: null,
  couponCode: null,
  appliedCoupon: null,
  discountAmount: 0,
  termsAccepted: false,
  orderId: null,
  orderNumber: null,
  idempotencyKey: null,
  isProcessing: false,
  error: null,
}

// Checkout state is persisted to sessionStorage so browser inactivity,
// soft-navigations, or hot-reloads do not wipe the address form between
// entry and final payment.
//
// sessionStorage (not localStorage) is deliberate:
//  - scoped to one browser tab → closing the tab resets the checkout
//  - dies with the session → no stale weeks-old checkout form
//  - cart stays in localStorage (cart-store) so items survive across visits,
//    but the in-progress checkout itself is session-local
//
// partialize() whitelist is intentionally minimal.
//
// Excluded on purpose:
//   - step                → user should re-enter the flow from guest-or-login
//   - shippingOption      → recomputed by step-shipping from the live cart
//                           (14.04 regression: stale shipping price survived
//                           subtotal changes across the free-ship threshold)
//   - paymentMethod       → re-selected each session
//   - appliedCoupon,
//     discountAmount      → RE-COMPUTED from a fresh validateCoupon() on
//                           rehydrate (see onRehydrateStorage below). Stale
//                           appliedCoupon/discountAmount would cause the
//                           shown "summary discount" to diverge from what
//                           the order-create applies.
//   - termsAccepted       → legal hygiene: AGB must be accepted per session
//   - orderId, orderNumber, idempotencyKey, isProcessing, error → ephemera
//
// Included (safe, form-only + the coupon code string only):
//   - guestEmail, shippingAddress, billingAddress,
//     billingSameAsShipping, savedAddressId
//   - couponCode → the string the user typed. NOT the derived appliedCoupon
//                  object, NOT the discountAmount. The onRehydrateStorage
//                  hook fires a fresh /coupons/validate with the current
//                  cart subtotal; if the call succeeds, setCoupon() restores
//                  the full triple. If it fails we keep couponCode in-store
//                  (optimistic) — the backend order-create is the final
//                  authority and rejects bad codes with 400 CouponRejected.
export const useCheckoutStore = create<CheckoutState>()(
  persist(
    (set) => ({
      ...initialState,

      setStep: (step) => set({ step, error: null }),
      setGuest: (isGuest, email) => set({ isGuest, guestEmail: email ?? '', step: 'address' }),
      setShippingAddress: (address) => set({ shippingAddress: address }),
      setBillingAddress: (address) => set({ billingAddress: address }),
      setBillingSameAsShipping: (same) => set({ billingSameAsShipping: same }),
      setSavedAddressId: (id) => set({ savedAddressId: id }),
      setShippingOption: (option) => set({ shippingOption: option }),
      setPaymentMethod: (method) => set({ paymentMethod: method }),
      setCoupon: (code, coupon, discount) => set({ couponCode: code, appliedCoupon: coupon, discountAmount: discount }),
      removeCoupon: () => set({ couponCode: null, appliedCoupon: null, discountAmount: 0 }),
      setTermsAccepted: (accepted) => set({ termsAccepted: accepted }),
      setOrder: (orderId, orderNumber) => set({ orderId, orderNumber }),
      setProcessing: (processing) => set({ isProcessing: processing }),
      setError: (error) => set({ error }),

      generateIdempotencyKey: () => {
        const key = crypto.randomUUID()
        set({ idempotencyKey: key })
        return key
      },

      reset: () => set(initialState),
    }),
    {
      name: 'malak-checkout',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        guestEmail: state.guestEmail,
        shippingAddress: state.shippingAddress,
        billingAddress: state.billingAddress,
        billingSameAsShipping: state.billingSameAsShipping,
        savedAddressId: state.savedAddressId,
        // ONLY the code string — not the derived appliedCoupon/discount.
        // onRehydrateStorage below re-computes those from a fresh validate.
        couponCode: state.couponCode,
      }),
      // After sessionStorage rehydrate: if a couponCode is present, fire a
      // lightweight revalidate with the current cart subtotal. This fixes
      // the silent-drop path where the user applied a coupon, the state
      // rehydrated (e.g. Stripe-widget mount/unmount remount), and the
      // derived appliedCoupon/discountAmount were lost. Without re-validate
      // the UI shows "coupon applied" but the summary shows 0 discount.
      //
      // Policy (answered B3 in the plan): OPTIMISTIC on failure. If the
      // network call itself fails (offline, 500), we keep the couponCode
      // in state and rely on the backend order-create's 400 CouponRejected
      // as the final safety net. Offline users should not be punished.
      onRehydrateStorage: () => (state) => {
        if (!state || !state.couponCode) return
        // Deferred import — couponRevalidator lives in a sibling module
        // that imports api.ts, which in turn touches this store during
        // its auth-state reads. Using a dynamic import breaks the
        // potential evaluation cycle.
        void import('@/lib/coupon-revalidator').then((m) => {
          m.revalidateCouponOnRehydrate(state.couponCode!)
        }).catch(() => { /* swallow — optimistic */ })
      },
    },
  ),
)
