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

// Fallback: kein Unsplash-Bild — eleganter Gradient wird als Hintergrund genutzt
const DEFAULT_HERO = ''

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

    // Parallax — subtle (12% instead of 20%, reduces motion sickness risk)
    gsap.to(imageWrap.current, {
      yPercent: 12,
      ease: 'none',
      scrollTrigger: { trigger: heroRef.current, start: 'top top', end: 'bottom top', scrub: true },
    })

    // Content reveal — snappier timings (max 600ms per UX guideline)
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' }, delay: 0.15 })
    tl.from('[data-hero-accent]', { scaleX: 0, transformOrigin: isRTL ? 'right' : 'left', duration: 0.4 })
      .from('[data-hero-eyebrow]', { y: 16, opacity: 0, duration: 0.45 }, '-=0.15')
      .from('[data-hero-heading]', { y: 40, opacity: 0, duration: 0.6 }, '-=0.25')
      .from('[data-hero-sub]', { y: 24, opacity: 0, duration: 0.45 }, '-=0.3')
      .from('[data-hero-cta]', { y: 16, opacity: 0, duration: 0.4 }, '-=0.25')
      .from('[data-hero-scroll]', { opacity: 0, duration: 0.3 }, '-=0.1')
  }, { scope: heroRef, dependencies: [reduced, isRTL] })

  const scrollDown = () => {
    const next = heroRef.current?.nextElementSibling
    next?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <section ref={heroRef} aria-label="Hero" className="relative w-full h-[100svh] min-h-[600px] overflow-hidden">
      {/* Background — image with parallax OR elegant gradient fallback */}
      {heroImage ? (
        <>
          <div ref={imageWrap} className="absolute inset-0 scale-[1.15]">
            <Image src={heroImage} alt={heading} fill priority sizes="100vw" className="object-cover" />
          </div>
          <div
            className="absolute inset-0"
            style={{
              background: isRTL
                ? 'linear-gradient(to left, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.35) 40%, transparent 70%)'
                : 'linear-gradient(to right, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.35) 40%, transparent 70%)',
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/10" />
        </>
      ) : (
        /* Premium gradient fallback — dark charcoal to subtle gold hint */
        <div className="absolute inset-0 bg-[#1a1a2e]">
          <div className="absolute inset-0 bg-gradient-to-br from-[#1a1a2e] via-[#1a1a2e] to-[#2a2233]" />
          <div className="absolute bottom-0 right-0 w-[60%] h-[60%] bg-[#d4a853]/[0.06] rounded-full blur-[120px] translate-x-1/4 translate-y-1/4" />
          <div className="absolute top-1/4 left-1/4 w-[30%] h-[30%] bg-[#d4a853]/[0.03] rounded-full blur-[80px]" />
        </div>
      )}

      {/* Content */}
      <div className="relative z-10 h-full flex items-center">
        <div className="mx-auto max-w-[1440px] px-6 sm:px-8 lg:px-12 w-full">
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
        <ChevronDown className="h-5 w-5 animate-fade-up motion-reduce:animate-none" style={{ animationDuration: '1.5s', animationIterationCount: '2' }} />
      </button>
    </section>
  )
}
