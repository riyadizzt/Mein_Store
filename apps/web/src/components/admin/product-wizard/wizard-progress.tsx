'use client'

import { Check, FileText, Palette, Image, Eye } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useProductWizardStore } from '@/store/product-wizard-store'

const STEPS = [
  { key: 'basics', labelKey: 'basics', icon: FileText },
  { key: 'variants', labelKey: 'variants', icon: Palette },
  { key: 'images', labelKey: 'images', icon: Image },
  { key: 'preview', labelKey: 'preview', icon: Eye },
] as const

const STEP_ORDER = ['basics', 'variants', 'images', 'preview'] as const

export function WizardProgress() {
  const t = useTranslations('admin')
  const { step, setStep } = useProductWizardStore()
  const currentIndex = STEP_ORDER.indexOf(step)

  return (
    <div className="flex items-center justify-between max-w-lg mx-auto mb-8">
      {STEPS.map((s, i) => {
        const isCompleted = i < currentIndex
        const isCurrent = s.key === step
        const canClick = i <= currentIndex

        return (
          <div key={s.key} className="flex items-center flex-1 last:flex-none">
            <button
              onClick={() => canClick && setStep(s.key)}
              disabled={!canClick}
              className={`flex items-center gap-2 ${canClick ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <div className={`h-10 w-10 rounded-full flex items-center justify-center text-sm transition-colors ${
                isCompleted
                  ? 'bg-green-500 text-white'
                  : isCurrent
                    ? 'bg-primary text-primary-foreground ring-4 ring-primary/20'
                    : 'bg-muted text-muted-foreground'
              }`}>
                {isCompleted ? <Check className="h-4 w-4" /> : <s.icon className="h-4 w-4" />}
              </div>
              <span className={`hidden sm:block text-sm ${isCurrent ? 'font-semibold' : 'text-muted-foreground'}`}>
                {t(`wizard.${s.labelKey}`)}
              </span>
            </button>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-3 ${isCompleted ? 'bg-green-500' : 'bg-muted'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
