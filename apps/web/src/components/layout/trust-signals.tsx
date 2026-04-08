'use client'

import { Truck, RotateCcw, Shield, CreditCard } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { motion } from 'motion/react'

export function TrustSignals() {
  const t = useTranslations('trust')

  const signals = [
    { icon: Truck, label: t('freeShipping') },
    { icon: RotateCcw, label: t('returns') },
    { icon: CreditCard, label: t('securePayment') },
    { icon: Shield, label: t('gdpr') },
  ]

  return (
    <section className="border-y border-border/30 py-4 sm:py-5 bg-paper/50">
      <div className="mx-auto max-w-[1440px] px-4 sm:px-8 lg:px-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
          {signals.map((signal, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.4 }}
              className="flex items-center gap-3 justify-center group"
            >
              <div className="h-9 w-9 rounded-full bg-brand-gold/8 flex items-center justify-center flex-shrink-0 transition-colors duration-300 group-hover:bg-brand-gold/15">
                <signal.icon className="h-4 w-4 text-brand-gold" strokeWidth={1.5} />
              </div>
              <span className="text-xs sm:text-sm font-medium text-ink/70">{signal.label}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
