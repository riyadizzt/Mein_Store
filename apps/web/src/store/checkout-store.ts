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
// partialize() whitelist is intentionally minimal: ONLY address-form fields
// that don't depend on the current cart contents. Anything derived from the
// cart (shippingOption, couponCode/appliedCoupon/discountAmount, paymentMethod)
// would go stale the moment the customer edits their cart mid-checkout —
// that's exactly how the 14.04.2026 "€140.89 vs €135.90" regression happened.
// The user came back to a cached shippingOption.price=4.99 after the subtotal
// crossed the free-shipping threshold and saw two conflicting numbers.
//
// Excluded on purpose:
//   - step                → user should re-enter the flow from guest-or-login
//   - shippingOption      → recomputed by step-shipping from the live cart
//   - paymentMethod       → re-selected each session
//   - couponCode,
//     appliedCoupon,
//     discountAmount      → re-validated each session (min-order-amount rules)
//   - termsAccepted       → legal hygiene: AGB must be accepted per session
//   - orderId, orderNumber, idempotencyKey, isProcessing, error → ephemera
//
// Included (safe, form-only):
//   - guestEmail, shippingAddress, billingAddress,
//     billingSameAsShipping, savedAddressId
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
      }),
    },
  ),
)
