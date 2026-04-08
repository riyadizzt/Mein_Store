'use client'

import { useRef } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Image from 'next/image'
import Link from 'next/link'
import { useCategories } from '@/hooks/use-categories'
import { ArrowRight } from 'lucide-react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(ScrollTrigger)

export function CategoryShowcase() {
  const locale = useLocale()
  const t = useTranslations('home')
  const { data: categories, isLoading } = useCategories()
  const sectionRef = useRef<HTMLElement>(null)

  useGSAP(() => {
    if (!categories?.length) return
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) return

    gsap.from('[data-cat-title]', {
      y: 30, opacity: 0, duration: 0.6, ease: 'power3.out',
      scrollTrigger: { trigger: sectionRef.current, start: 'top 80%', once: true },
    })

    gsap.from('[data-cat-card]', {
      y: 48, opacity: 0, scale: 0.97, duration: 0.55, ease: 'power3.out', stagger: 0.08,
      scrollTrigger: { trigger: sectionRef.current, start: 'top 75%', once: true },
    })
  }, { scope: sectionRef, dependencies: [categories] })

  if (isLoading) {
    return (
      <section className="py-20 px-6 sm:px-8 lg:px-12 max-w-7xl mx-auto">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6 h-[500px]">
          {[1, 2, 3].map((i) => <div key={i} className="rounded-2xl animate-shimmer" />)}
        </div>
      </section>
    )
  }

  if (!categories || categories.length === 0) return null

  const getName = (cat: any) =>
    cat.name ?? cat.translations?.find((tr: any) => tr.language === locale)?.name ?? cat.translations?.[0]?.name ?? cat.slug

  // Asymmetric layout: first category large, rest smaller
  const primary = categories[0]
  const secondary = categories.slice(1, 3)
  const tertiary = categories.slice(3, 5)

  return (
    <section ref={sectionRef} aria-label={t('categories')} className="py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-6 sm:px-8 lg:px-12">
        {/* Section header */}
        <div data-cat-title className="flex items-end justify-between mb-10">
          <div>
            <p className="text-brand-gold text-sm font-medium tracking-[0.2em] uppercase mb-2">
              {locale === 'ar' ? 'تسوق حسب الفئة' : locale === 'en' ? 'Shop by Category' : 'Nach Kategorie shoppen'}
            </p>
            <h2 className="text-3xl sm:text-4xl font-display font-bold">{t('categories')}</h2>
          </div>
          <Link
            href={`/${locale}/products`}
            className="hidden sm:flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {locale === 'ar' ? 'عرض الكل' : locale === 'en' ? 'View all' : 'Alle ansehen'}
            <ArrowRight className="h-4 w-4 rtl:rotate-180" />
          </Link>
        </div>

        {/* Asymmetric grid */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5">
          {/* Primary — large card spanning 2 rows on desktop */}
          {primary && (
            <Link
              href={`/${locale}/products?department=${primary.slug}`}
              data-cat-card
              className="group relative col-span-2 lg:col-span-1 lg:row-span-2 aspect-[4/3] lg:aspect-auto rounded-2xl overflow-hidden"
            >
              {primary.imageUrl ? (
                <Image src={primary.imageUrl} alt={getName(primary)} fill sizes="(max-width: 1024px) 100vw, 40vw"
                  className="object-cover transition-transform duration-700 ease-out will-change-transform group-hover:scale-[1.06]" />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-brand-gold/20 to-brand-gold/5" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent transition-opacity duration-500 group-hover:from-black/80" />
              <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8">
                <div className="h-[2px] w-8 bg-brand-gold mb-3 transition-all duration-500 group-hover:w-12" />
                <h3 className="text-2xl sm:text-3xl font-display font-bold text-white">{getName(primary)}</h3>
                <div className="flex items-center gap-2 mt-3 text-white/60 text-sm opacity-0 translate-y-2 transition-all duration-300 group-hover:opacity-100 group-hover:translate-y-0">
                  <span>{t('cta')}</span>
                  <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
                </div>
              </div>
            </Link>
          )}

          {/* Secondary cards */}
          {secondary.map((cat: any) => (
            <Link
              key={cat.id}
              href={`/${locale}/products?department=${cat.slug}`}
              data-cat-card
              className="group relative aspect-[4/5] rounded-2xl overflow-hidden"
            >
              {cat.imageUrl ? (
                <Image src={cat.imageUrl} alt={getName(cat)} fill sizes="(max-width: 1024px) 50vw, 30vw"
                  className="object-cover transition-transform duration-700 ease-out will-change-transform group-hover:scale-[1.06]" />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-muted to-muted/50" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-6">
                <div className="h-[2px] w-6 bg-brand-gold mb-2 transition-all duration-500 group-hover:w-10" />
                <h3 className="text-xl sm:text-2xl font-display font-bold text-white">{getName(cat)}</h3>
                <div className="flex items-center gap-1.5 mt-2 text-white/60 text-sm opacity-0 translate-y-2 transition-all duration-300 group-hover:opacity-100 group-hover:translate-y-0">
                  <span>{t('cta')}</span>
                  <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
                </div>
              </div>
            </Link>
          ))}

          {/* Tertiary cards — smaller, bottom row */}
          {tertiary.map((cat: any) => (
            <Link
              key={cat.id}
              href={`/${locale}/products?department=${cat.slug}`}
              data-cat-card
              className="group relative aspect-[3/2] rounded-2xl overflow-hidden"
            >
              {cat.imageUrl ? (
                <Image src={cat.imageUrl} alt={getName(cat)} fill sizes="(max-width: 1024px) 50vw, 30vw"
                  className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]" />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-muted to-muted/50" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-5">
                <h3 className="text-lg font-bold text-white">{getName(cat)}</h3>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
