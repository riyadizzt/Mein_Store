'use client'

import { Check, MapPin, Truck, CreditCard, PartyPopper } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCheckoutStore } from '@/store/checkout-store'

const STEPS = [
  { key: 'address', labelKey: 'step1', icon: MapPin },
  { key: 'shipping', labelKey: 'step2', icon: Truck },
  { key: 'payment', labelKey: 'step3', icon: CreditCard },
  { key: 'confirmation', labelKey: 'step4', icon: PartyPopper },
] as const

const STEP_ORDER = ['guest', 'address', 'shipping', 'payment', 'confirmation'] as const

export function CheckoutProgressBar() {
  const t = useTranslations('checkout')
  const { step, setStep } = useCheckoutStore()

  const currentIndex = STEP_ORDER.indexOf(step)

  const canNavigateTo = (targetStep: string) => {
    const targetIndex = STEP_ORDER.indexOf(targetStep as any)
    return targetIndex < currentIndex && step !== 'confirmation'
  }

  return (
    <div className="flex items-center justify-between max-w-lg mx-auto py-6">
      {STEPS.map((s, i) => {
        const stepIndex = STEP_ORDER.indexOf(s.key)
        const isCompleted = stepIndex < currentIndex
        const isCurrent = s.key === step
        const isClickable = canNavigateTo(s.key)

        return (
          <div key={s.key} className="flex items-center flex-1 last:flex-none">
            {/* Step Circle */}
            <button
              onClick={() => isClickable && setStep(s.key as any)}
              disabled={!isClickable}
              className={`flex items-center gap-2 ${isClickable ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <div
                className={`h-11 w-11 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-200 ${
                  isCompleted
                    ? 'bg-accent text-accent-foreground'
                    : isCurrent
                      ? 'bg-accent text-accent-foreground ring-4 ring-accent/20'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {isCompleted ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <s.icon className="h-4 w-4" />
                )}
              </div>
              <span className={`hidden sm:block text-sm ${isCurrent ? 'font-semibold' : 'text-muted-foreground'}`}>
                {t(s.labelKey)}
              </span>
            </button>

            {/* Connector Line */}
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-1 mx-3 rounded-full ${isCompleted ? 'bg-accent' : 'bg-muted'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
