'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale } from 'next-intl'
import { Users, Star, RotateCcw, ShieldCheck } from 'lucide-react'

function useCountUp(target: number, duration = 1500) {
  const [value, setValue] = useState(0)
  const [started, setStarted] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setStarted(true); observer.disconnect() } },
      { threshold: 0.3 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!started) return
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) { setValue(target); return }

    const startTime = performance.now()
    const tick = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3) // ease-out cubic
      setValue(Math.floor(eased * target))
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [started, target, duration])

  return { value, ref }
}

const STATS = {
  de: [
    { icon: Users, value: 2000, suffix: '+', label: 'Zufriedene Kunden' },
    { icon: Star, value: 4.9, suffix: '', label: 'Kundenbewertung', decimals: 1 },
    { icon: RotateCcw, value: 14, suffix: ' Tage', label: 'R\u00FCckgaberecht' },
    { icon: ShieldCheck, value: 100, suffix: '%', label: 'Sichere Bezahlung' },
  ],
  en: [
    { icon: Users, value: 2000, suffix: '+', label: 'Happy Customers' },
    { icon: Star, value: 4.9, suffix: '', label: 'Customer Rating', decimals: 1 },
    { icon: RotateCcw, value: 14, suffix: ' days', label: 'Return Policy' },
    { icon: ShieldCheck, value: 100, suffix: '%', label: 'Secure Payment' },
  ],
  ar: [
    { icon: Users, value: 2000, suffix: '+', label: '\u0639\u0645\u0644\u0627\u0621 \u0633\u0639\u062F\u0627\u0621' },
    { icon: Star, value: 4.9, suffix: '', label: '\u062A\u0642\u064A\u064A\u0645 \u0627\u0644\u0639\u0645\u0644\u0627\u0621', decimals: 1 },
    { icon: RotateCcw, value: 14, suffix: ' \u064A\u0648\u0645', label: '\u0644\u0644\u0625\u0631\u062C\u0627\u0639' },
    { icon: ShieldCheck, value: 100, suffix: '%', label: '\u062F\u0641\u0639 \u0622\u0645\u0646' },
  ],
}

function CounterItem({ icon: Icon, value, suffix, label, decimals }: {
  icon: any; value: number; suffix: string; label: string; decimals?: number
}) {
  const { value: count, ref } = useCountUp(decimals ? Math.round(value * 10) : value)
  const display = decimals ? (count / 10).toFixed(decimals) : count.toLocaleString('de-DE')

  return (
    <div ref={ref} className="flex flex-col items-center text-center group">
      <div className="h-12 w-12 rounded-2xl bg-brand-gold/10 flex items-center justify-center mb-3 group-hover:bg-brand-gold/20 transition-colors duration-300">
        <Icon className="h-5 w-5 text-brand-gold" />
      </div>
      <span className="text-3xl font-bold tabular-nums text-ink tracking-tight">
        {display}{suffix}
      </span>
      <span className="text-sm text-ink/50 mt-1">{label}</span>
    </div>
  )
}

export function TrustCounter() {
  const locale = useLocale()
  const stats = STATS[locale as keyof typeof STATS] ?? STATS.de

  return (
    <section className="py-16 bg-warm">
      <div className="max-w-5xl mx-auto px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((stat, i) => (
            <CounterItem key={i} {...stat} />
          ))}
        </div>
      </div>
    </section>
  )
}
