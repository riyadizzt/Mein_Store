'use client'

import { useLocale } from 'next-intl'
import { Truck, RotateCcw, Shield, Sparkles } from 'lucide-react'

const ITEMS_DE = [
  { icon: Truck, text: 'Kostenloser Versand ab 50\u20AC' },
  { icon: RotateCcw, text: '14 Tage kostenlose R\u00FCcksendung' },
  { icon: Shield, text: 'Sichere Bezahlung' },
  { icon: Sparkles, text: 'Premium Qualit\u00E4t' },
]
const ITEMS_AR = [
  { icon: Truck, text: '\u0634\u062D\u0646 \u0645\u062C\u0627\u0646\u064A \u0645\u0646 50\u20AC' },
  { icon: RotateCcw, text: '\u0625\u0631\u062C\u0627\u0639 \u0645\u062C\u0627\u0646\u064A \u062E\u0644\u0627\u0644 14 \u064A\u0648\u0645' },
  { icon: Shield, text: '\u062F\u0641\u0639 \u0622\u0645\u0646' },
  { icon: Sparkles, text: '\u062C\u0648\u062F\u0629 \u0645\u0645\u064A\u0632\u0629' },
]
const ITEMS_EN = [
  { icon: Truck, text: 'Free shipping over \u20AC50' },
  { icon: RotateCcw, text: '14-day free returns' },
  { icon: Shield, text: 'Secure payment' },
  { icon: Sparkles, text: 'Premium quality' },
]

export function AnnouncementBar() {
  const locale = useLocale()
  const items = locale === 'ar' ? ITEMS_AR : locale === 'en' ? ITEMS_EN : ITEMS_DE
  // Double the items for seamless infinite scroll
  const doubled = [...items, ...items, ...items]

  return (
    <div className="bg-ink text-cream overflow-hidden relative h-9 flex items-center select-none" aria-label="Announcements">
      <div
        className="flex gap-8 whitespace-nowrap animate-marquee"
        style={{ animationDirection: locale === 'ar' ? 'reverse' : 'normal' }}
      >
        {doubled.map((item, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 text-xs font-medium tracking-wide">
            <item.icon className="h-3 w-3 text-brand-gold" />
            {item.text}
            <span className="text-brand-gold/40 ltr:ml-4 rtl:mr-4">\u2022</span>
          </span>
        ))}
      </div>

      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-33.333%); }
        }
        .animate-marquee {
          animation: marquee 30s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-marquee { animation: none; }
        }
      `}</style>
    </div>
  )
}
