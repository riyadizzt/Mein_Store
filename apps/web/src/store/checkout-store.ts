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
// soft-navigations, or hot-reloads do not wipe guestEmail / shippingAddress
// / coupon between entry and final payment.
//
// sessionStorage (not localStorage) is deliberate:
//  - scoped to one browser tab → closing the tab resets the checkout
//  - dies with the session → no stale weeks-old checkout form
//  - cart stays in localStorage (cart-store) so items survive across visits,
//    but the in-progress checkout itself is session-local
//
// partialize() whitelists FORM fields only. The ephemeral per-attempt state
// (orderId, orderNumber, idempotencyKey, isProcessing, error) MUST reset
// between attempts — persisting them would cause "ghost order" state after a
// failed retry. If you add a new ephemeral field, do NOT put it in partialize.
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
        step: state.step,
        isGuest: state.isGuest,
        guestEmail: state.guestEmail,
        shippingAddress: state.shippingAddress,
        billingAddress: state.billingAddress,
        billingSameAsShipping: state.billingSameAsShipping,
        savedAddressId: state.savedAddressId,
        shippingOption: state.shippingOption,
        paymentMethod: state.paymentMethod,
        couponCode: state.couponCode,
        appliedCoupon: state.appliedCoupon,
        discountAmount: state.discountAmount,
        termsAccepted: state.termsAccepted,
      }),
    },
  ),
)
