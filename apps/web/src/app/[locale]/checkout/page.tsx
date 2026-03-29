'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { useCartStore } from '@/store/cart-store'
import { useCheckoutStore } from '@/store/checkout-store'
import { CheckoutProgressBar } from '@/components/checkout/progress-bar'
import { GuestOrLogin } from '@/components/checkout/guest-or-login'
import { StepAddress } from '@/components/checkout/step-address'
import { StepShipping } from '@/components/checkout/step-shipping'
import { StepPayment } from '@/components/checkout/step-payment'

export default function CheckoutPage() {
  const locale = useLocale()
  const router = useRouter()
  const itemCount = useCartStore((s) => s.itemCount())
  const step = useCheckoutStore((s) => s.step)

  // Redirect if cart is empty — but NOT during payment processing
  const isProcessing = useCheckoutStore((s) => s.isProcessing)
  useEffect(() => {
    if (itemCount === 0 && step !== 'confirmation' && step !== 'payment' && !isProcessing) {
      router.replace(`/${locale}/products`)
    }
  }, [itemCount, step, isProcessing, router, locale])

  if (itemCount === 0 && step !== 'confirmation' && step !== 'payment' && !isProcessing) return null

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
      {step !== 'guest' && step !== 'confirmation' && <CheckoutProgressBar />}

      {step === 'guest' && <GuestOrLogin locale={locale} />}
      {step === 'address' && <StepAddress />}
      {step === 'shipping' && <StepShipping />}
      {step === 'payment' && <StepPayment />}
    </div>
  )
}
