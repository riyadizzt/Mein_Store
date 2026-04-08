'use client'

import { Check, MapPin, Truck, CreditCard, PartyPopper } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCheckoutStore } from '@/store/checkout-store'
import { motion } from 'motion/react'

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
              <motion.div
                initial={false}
                animate={{
                  scale: isCurrent ? 1 : 1,
                  backgroundColor: isCompleted || isCurrent
                    ? 'hsl(var(--accent))'
                    : 'hsl(var(--muted))',
                }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className={`h-11 w-11 rounded-full flex items-center justify-center text-sm font-medium ${
                  isCompleted || isCurrent
                    ? 'text-accent-foreground'
                    : 'text-muted-foreground'
                } ${isCurrent ? 'ring-4 ring-accent/20' : ''}`}
              >
                {isCompleted ? (
                  <motion.div
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                  >
                    <Check className="h-4 w-4" />
                  </motion.div>
                ) : (
                  <s.icon className="h-4 w-4" />
                )}
              </motion.div>
              <span className={`hidden sm:block text-sm ${isCurrent ? 'font-semibold' : 'text-muted-foreground'}`}>
                {t(s.labelKey)}
              </span>
            </button>

            {/* Connector Line — animated fill */}
            {i < STEPS.length - 1 && (
              <div className="flex-1 h-1 mx-3 rounded-full bg-muted overflow-hidden">
                <motion.div
                  initial={false}
                  animate={{ width: isCompleted ? '100%' : '0%' }}
                  transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
                  className="h-full bg-accent rounded-full"
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
