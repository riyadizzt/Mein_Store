'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLocale } from 'next-intl'
import { useCartStore } from '@/store/cart-store'
import { useCheckoutStore } from '@/store/checkout-store'
import { CheckoutProgressBar } from '@/components/checkout/progress-bar'
import { GuestOrLogin } from '@/components/checkout/guest-or-login'
import { StepAddress } from '@/components/checkout/step-address'
import { StepShipping } from '@/components/checkout/step-shipping'
import { StepPayment } from '@/components/checkout/step-payment'
import { AnimatePresence, motion } from 'motion/react'
import { API_BASE_URL } from '@/lib/env'

export default function CheckoutPage() {
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const itemCount = useCartStore((s) => s.itemCount())
  const step = useCheckoutStore((s) => s.step)
  const [abortNotice, setAbortNotice] = useState<string | null>(null)

  // Redirect if cart is empty — but NOT during payment processing
  const isProcessing = useCheckoutStore((s) => s.isProcessing)
  useEffect(() => {
    if (itemCount === 0 && step !== 'confirmation' && step !== 'payment' && !isProcessing) {
      router.replace(`/${locale}/products`)
    }
  }, [itemCount, step, isProcessing, router, locale])

  // Cancel-return from a redirect-based gateway (PayPal "Abbrechen", Klarna cancel, …).
  // We get ?cancelled=<orderId> on the URL — call the abort endpoint to flip the
  // order to cancelled so it stops appearing as "pending payment" everywhere.
  useEffect(() => {
    const cancelledOrderId = searchParams.get('cancelled')
    if (!cancelledOrderId) return

    fetch(`${API_BASE_URL}/api/v1/payments/${cancelledOrderId}/abort`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    }).catch(() => {})

    // Clear sessionStorage from the previous PayPal/Klarna attempt
    try {
      sessionStorage.removeItem('malak-paypal-orderId')
      sessionStorage.removeItem('malak-payment-method')
      sessionStorage.removeItem('malak-last-order')
    } catch {}

    setAbortNotice(
      locale === 'ar' ? 'تم إلغاء الدفع. يمكنك المحاولة مرة أخرى.'
      : locale === 'en' ? 'Payment cancelled. You can try again.'
      : 'Zahlung abgebrochen. Du kannst es erneut versuchen.',
    )

    // Strip the cancelled param from the URL so a refresh doesn't re-trigger it
    const url = new URL(window.location.href)
    url.searchParams.delete('cancelled')
    window.history.replaceState({}, '', url.toString())
  }, [searchParams, locale])

  if (itemCount === 0 && step !== 'confirmation' && step !== 'payment' && !isProcessing) return null

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
      {step !== 'guest' && step !== 'confirmation' && <CheckoutProgressBar />}

      {abortNotice && (
        <div
          className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          role="status"
        >
          {abortNotice}
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
        >
          {step === 'guest' && <GuestOrLogin locale={locale} />}
          {step === 'address' && <StepAddress />}
          {step === 'shipping' && <StepShipping />}
          {step === 'payment' && <StepPayment />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
