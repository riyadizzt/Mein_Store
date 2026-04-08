'use client'

import { useRef } from 'react'
import { useLocale } from 'next-intl'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(ScrollTrigger)

const COPY = {
  de: { eyebrow: 'Unser Versprechen', heading: 'Qualität, die man spürt.', body: 'Jedes Stück wird mit Sorgfalt ausgewählt — für Menschen, die Wert auf Stil und Vertrauen legen.', cta: 'Mehr erfahren' },
  en: { eyebrow: 'Our Promise', heading: 'Quality you can feel.', body: 'Every piece is carefully curated — for people who value style and trust.', cta: 'Learn more' },
  ar: { eyebrow: 'وعدنا', heading: 'جودة تلمسها.', body: 'كل قطعة مختارة بعناية — لمن يقدّرون الأناقة والثقة.', cta: 'اعرف أكثر' },
}

export function EditorialBanner({ locale }: { locale: string }) {
  const currentLocale = useLocale() as 'de' | 'en' | 'ar'
  const copy = COPY[currentLocale] ?? COPY.de
  const sectionRef = useRef<HTMLElement>(null)

  useGSAP(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) return

    gsap.from('[data-editorial-text]', {
      y: 40, opacity: 0, duration: 0.8, ease: 'power3.out', stagger: 0.12,
      scrollTrigger: { trigger: sectionRef.current, start: 'top 75%', once: true },
    })
  }, { scope: sectionRef })

  return (
    <section ref={sectionRef} aria-label={copy.eyebrow} className="relative py-24 sm:py-32 bg-warm overflow-hidden">
      {/* Subtle decorative elements */}
      <div className="absolute top-0 left-0 w-72 h-72 bg-brand-gold/8 rounded-full blur-[80px] -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute bottom-0 right-0 w-[28rem] h-[28rem] bg-brand-gold/6 rounded-full blur-[100px] translate-x-1/3 translate-y-1/3" />

      <div className="relative mx-auto max-w-4xl px-6 sm:px-8 text-center backdrop-blur-[1px]">
        <p data-editorial-text className="text-brand-gold text-sm font-medium tracking-[0.25em] uppercase mb-6">
          {copy.eyebrow}
        </p>
        <h2 data-editorial-text className="text-3xl sm:text-4xl md:text-5xl font-display font-bold leading-[1.15] text-ink">
          {copy.heading}
        </h2>
        <p data-editorial-text className="mt-6 text-lg text-ink/60 leading-relaxed max-w-2xl mx-auto">
          {copy.body}
        </p>
        <div data-editorial-text className="mt-10">
          <Link
            href={`/${locale}/legal/impressum`}
            className="inline-flex items-center gap-2 text-sm font-semibold text-ink hover:text-brand-gold transition-colors underline underline-offset-4 decoration-brand-gold/30 hover:decoration-brand-gold"
          >
            {copy.cta}
            <ArrowRight className="h-4 w-4 rtl:rotate-180" />
          </Link>
        </div>
      </div>
    </section>
  )
}
