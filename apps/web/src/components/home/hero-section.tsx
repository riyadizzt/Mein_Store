'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, ChevronDown } from 'lucide-react'
import { useShopSettings } from '@/hooks/use-shop-settings'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(ScrollTrigger)

const DEFAULT_HERO = 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1600&q=80&auto=format&fit=crop'

function MagneticCTA({ children, href }: { children: React.ReactNode; href: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const onMove = useCallback((e: React.MouseEvent) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left - rect.width / 2
    const y = e.clientY - rect.top - rect.height / 2
    gsap.to(el, { x: x * 0.2, y: y * 0.2, duration: 0.3, ease: 'power2.out' })
  }, [])
  const onLeave = useCallback(() => {
    gsap.to(ref.current, { x: 0, y: 0, duration: 0.6, ease: 'elastic.out(1, 0.3)' })
  }, [])

  return (
    <div ref={ref} className="inline-block will-change-transform" onMouseMove={onMove} onMouseLeave={onLeave}>
      <Link href={href}>{children}</Link>
    </div>
  )
}

export function HeroSection({ locale }: { locale: string }) {
  const t = useTranslations('home')
  const currentLocale = useLocale() as 'de' | 'en' | 'ar'
  const { data: settings } = useShopSettings()
  const [reduced, setReduced] = useState(false)
  const heroRef = useRef<HTMLElement>(null)
  const imageWrap = useRef<HTMLDivElement>(null)
  const isRTL = currentLocale === 'ar'

  const heroImage = settings?.heroBanner?.image || DEFAULT_HERO
  const heading = settings?.heroBanner?.title?.[currentLocale] || t('welcome')
  const sub = settings?.heroBanner?.subtitle?.[currentLocale] || t('subtitle')
  const ctaText = settings?.heroBanner?.cta?.[currentLocale] || t('cta')
  const ctaLink = settings?.heroBanner?.ctaLink || `/${locale}/products`

  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  }, [])

  useGSAP(() => {
    if (reduced) return

    // Parallax
    gsap.to(imageWrap.current, {
      yPercent: 20,
      ease: 'none',
      scrollTrigger: { trigger: heroRef.current, start: 'top top', end: 'bottom top', scrub: true },
    })

    // Content reveal
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' }, delay: 0.2 })
    tl.from('[data-hero-accent]', { scaleX: 0, transformOrigin: isRTL ? 'right' : 'left', duration: 0.5 })
      .from('[data-hero-eyebrow]', { y: 20, opacity: 0, duration: 0.6 }, '-=0.2')
      .from('[data-hero-heading]', { y: 50, opacity: 0, duration: 0.8 }, '-=0.3')
      .from('[data-hero-sub]', { y: 30, opacity: 0, duration: 0.6 }, '-=0.4')
      .from('[data-hero-cta]', { y: 20, opacity: 0, duration: 0.5 }, '-=0.3')
      .from('[data-hero-scroll]', { opacity: 0, duration: 0.4 }, '-=0.1')
  }, { scope: heroRef, dependencies: [reduced, isRTL] })

  const scrollDown = () => {
    const next = heroRef.current?.nextElementSibling
    next?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <section ref={heroRef} className="relative w-full h-[100svh] min-h-[600px] overflow-hidden">
      {/* Background with parallax */}
      <div ref={imageWrap} className="absolute inset-0 will-change-transform scale-[1.2]">
        <Image src={heroImage} alt="" fill priority sizes="100vw" className="object-cover" />
      </div>

      {/* Gradient overlays */}
      <div
        className="absolute inset-0"
        style={{
          background: isRTL
            ? 'linear-gradient(to left, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.35) 40%, transparent 70%)'
            : 'linear-gradient(to right, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.35) 40%, transparent 70%)',
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/10" />

      {/* Content */}
      <div className="relative z-10 h-full flex items-center">
        <div className="mx-auto max-w-7xl px-6 sm:px-8 lg:px-12 w-full">
          <div className="max-w-2xl">
            {/* Gold accent */}
            <div data-hero-accent className="h-[3px] w-12 bg-brand-gold mb-6 rounded-full" />

            {/* Eyebrow */}
            <p data-hero-eyebrow className="text-brand-gold-light text-sm font-medium tracking-[0.25em] uppercase mb-4">
              {currentLocale === 'ar' ? 'مجموعة جديدة' : currentLocale === 'en' ? 'New Collection' : 'Neue Kollektion'}
            </p>

            {/* Heading — large display font */}
            <h1
              data-hero-heading
              className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-display font-bold text-white leading-[1.05] tracking-tight"
            >
              {heading}
            </h1>

            {/* Subtitle */}
            <p data-hero-sub className="mt-6 text-lg sm:text-xl text-white/75 leading-relaxed max-w-lg">
              {sub}
            </p>

            {/* CTA */}
            <div data-hero-cta className="mt-10 flex items-center gap-4">
              <MagneticCTA href={ctaLink.startsWith('/') ? `/${locale}${ctaLink}` : ctaLink}>
                <span className="inline-flex items-center gap-3 h-14 px-10 bg-white text-ink text-base font-semibold rounded-full shadow-elevated transition-all duration-300 hover:shadow-xl hover:scale-[1.02] btn-press">
                  {ctaText}
                  <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                </span>
              </MagneticCTA>
              <Link
                href={`/${locale}/products`}
                className="text-white/70 hover:text-white text-sm font-medium transition-colors underline underline-offset-4 decoration-white/30 hover:decoration-white/60"
              >
                {currentLocale === 'ar' ? 'تصفح الكل' : currentLocale === 'en' ? 'Browse all' : 'Alle ansehen'}
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <button
        data-hero-scroll
        onClick={scrollDown}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2 text-white/50 hover:text-white transition-colors"
        aria-label="Scroll down"
      >
        <span className="text-[10px] tracking-[0.3em] uppercase">Scroll</span>
        <ChevronDown className="h-5 w-5 animate-bounce" />
      </button>
    </section>
  )
}
