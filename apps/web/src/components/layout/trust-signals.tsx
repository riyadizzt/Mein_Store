import { Truck, RotateCcw, Shield, CreditCard } from 'lucide-react'
import { useTranslations } from 'next-intl'

export function TrustSignals() {
  const t = useTranslations('trust')

  const signals = [
    { icon: Truck, label: t('freeShipping') },
    { icon: RotateCcw, label: t('returns') },
    { icon: CreditCard, label: t('securePayment') },
    { icon: Shield, label: t('gdpr') },
  ]

  return (
    <section className="bg-foreground text-background py-5">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {signals.map((signal, i) => (
            <div key={i} className="flex items-center gap-3 justify-center">
              <div className="h-10 w-10 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                <signal.icon className="h-5 w-5 text-accent" />
              </div>
              <span className="text-sm font-medium text-white/90">{signal.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
