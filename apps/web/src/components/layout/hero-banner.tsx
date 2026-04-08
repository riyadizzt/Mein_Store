'use client'

import { useRef, useCallback, useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useShopSettings } from '@/hooks/use-shop-settings'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(ScrollTrigger)

const DEFAULT_HERO = 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&q=75&auto=format&fit=crop'

/* ── Magnetic CTA — follows cursor with elastic snap-back ── */
function MagneticCTA({
  children,
  href,
}: {
  children: React.ReactNode
  href: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  const onMove = useCallback((e: React.MouseEvent) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left - rect.width / 2
    const y = e.clientY - rect.top - rect.height / 2
    gsap.to(el, { x: x * 0.25, y: y * 0.25, duration: 0.3, ease: 'power2.out' })
  }, [])

  const onLeave = useCallback(() => {
    gsap.to(ref.current, { x: 0, y: 0, duration: 0.6, ease: 'elastic.out(1, 0.3)' })
  }, [])

  return (
    <div
      ref={ref}
      className="inline-block will-change-transform"
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      <Link href={href}>{children}</Link>
    </div>
  )
}

/* ── Hero Banner ── */
export function HeroBanner({ locale }: { locale: string }) {
  const t = useTranslations('home')
  const currentLocale = useLocale() as 'de' | 'en' | 'ar'
  const { data: settings } = useShopSettings()
  const [prefersReduced, setPrefersReduced] = useState(false)

  const heroRef = useRef<HTMLElement>(null)
  const imageWrap = useRef<HTMLDivElement>(null)
  const accent = useRef<HTMLDivElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const subtitle = useRef<HTMLParagraphElement>(null)
  const ctaWrap = useRef<HTMLDivElement>(null)

  const heroImage = settings?.heroBanner?.image || DEFAULT_HERO
  const heading = settings?.heroBanner?.title?.[currentLocale] || t('welcome')
  const sub = settings?.heroBanner?.subtitle?.[currentLocale] || t('subtitle')
  const ctaText = settings?.heroBanner?.cta?.[currentLocale] || t('cta')
  const ctaLink = settings?.heroBanner?.ctaLink || `/${locale}/products`
  const isRTL = currentLocale === 'ar'

  useEffect(() => {
    setPrefersReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  }, [])

  /* GSAP animations */
  useGSAP(
    () => {
      if (prefersReduced) return

      /* Parallax — image drifts up on scroll */
      gsap.to(imageWrap.current, {
        yPercent: 15,
        ease: 'none',
        scrollTrigger: {
          trigger: heroRef.current,
          start: 'top top',
          end: 'bottom top',
          scrub: true,
        },
      })

      /* Content reveal timeline */
      const tl = gsap.timeline({
        defaults: { ease: 'power3.out', duration: 0.7 },
        delay: 0.15,
      })

      tl.from(accent.current, {
        scaleX: 0,
        transformOrigin: isRTL ? 'right center' : 'left center',
        duration: 0.5,
      })
        .from(
          title.current,
          { y: 60, opacity: 0, duration: 0.9 },
          '-=0.15',
        )
        .from(
          subtitle.current,
          { y: 40, opacity: 0, duration: 0.7 },
          '-=0.45',
        )
        .from(
          ctaWrap.current,
          { y: 30, opacity: 0, duration: 0.6 },
          '-=0.35',
        )
    },
    { scope: heroRef, dependencies: [prefersReduced, isRTL] },
  )

  return (
    <section
      ref={heroRef}
      className="relative w-full h-[70vh] max-h-[700px] min-h-[500px] overflow-hidden"
    >
      {/* Parallax Image */}
      <div ref={imageWrap} className="absolute inset-0 will-change-transform scale-[1.15]">
        <Image
          src={heroImage}
          alt={heading}
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
      </div>

      {/* Gradient overlays */}
      <div
        className="absolute inset-0"
        style={{
          background: isRTL
            ? 'linear-gradient(to left, rgba(0,0,0,0.7), rgba(0,0,0,0.4) 50%, transparent)'
            : 'linear-gradient(to right, rgba(0,0,0,0.7), rgba(0,0,0,0.4) 50%, transparent)',
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />

      {/* Content */}
      <div className="relative z-10 h-full flex items-center">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 w-full">
          <div className="max-w-xl">
            {/* Gold accent bar */}
            <div
              ref={accent}
              className="h-1 w-16 bg-brand-gold mb-6 rounded-full"
            />

            <h1
              ref={title}
              className="text-4xl sm:text-5xl lg:text-6xl font-display font-bold text-white leading-[1.1]"
            >
              {heading}
            </h1>

            <p
              ref={subtitle}
              className="mt-5 text-lg sm:text-xl text-white/80 leading-relaxed"
            >
              {sub}
            </p>

            <div ref={ctaWrap} className="mt-8">
              <MagneticCTA
                href={
                  ctaLink.startsWith('/') ? `/${locale}${ctaLink}` : ctaLink
                }
              >
                <Button
                  size="lg"
                  className="h-14 px-10 text-base font-semibold gap-2 bg-white text-foreground hover:bg-white/90 shadow-elevated transition-all duration-300 hover:shadow-xl hover:scale-[1.02] btn-press"
                >
                  {ctaText}
                  <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1 rtl:group-hover:-translate-x-1 rtl:rotate-180" />
                </Button>
              </MagneticCTA>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
