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

export function CategoryGrid() {
  const locale = useLocale()
  const t = useTranslations('home')
  const { data: categories, isLoading, isError } = useCategories()
  const gridRef = useRef<HTMLDivElement>(null)

  /* GSAP — staggered scroll-triggered reveal */
  useGSAP(
    () => {
      if (!categories?.length) return
      const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (prefersReduced) return

      const cards = gridRef.current?.querySelectorAll('[data-category-card]')
      if (!cards?.length) return

      gsap.set(cards, { y: 60, opacity: 0, scale: 0.95 })

      ScrollTrigger.batch(cards, {
        onEnter: (batch) => {
          gsap.to(batch, {
            y: 0,
            opacity: 1,
            scale: 1,
            duration: 0.7,
            ease: 'power3.out',
            stagger: 0.12,
          })
        },
        start: 'top 85%',
        once: true,
      })
    },
    { scope: gridRef, dependencies: [categories] },
  )

  if (isError) return null

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="aspect-[3/4] rounded-2xl animate-shimmer" />
        ))}
      </div>
    )
  }

  if (!categories || categories.length === 0) return null

  return (
    <div ref={gridRef} className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
      {categories.map((cat: any) => {
        const name =
          cat.name ??
          cat.translations?.find((tr: any) => tr.language === locale)?.name ??
          cat.translations?.[0]?.name ??
          cat.slug

        return (
          <Link
            key={cat.id}
            href={`/${locale}/products?department=${cat.slug}`}
            data-category-card
            className="group relative block aspect-[3/4] rounded-2xl overflow-hidden"
          >
            {/* Image with enhanced zoom */}
            {cat.imageUrl ? (
              <Image
                src={cat.imageUrl}
                alt={name}
                fill
                sizes="(max-width: 640px) 50vw, 25vw"
                className="object-cover transition-transform duration-700 ease-out will-change-transform group-hover:scale-[1.12]"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-muted to-muted/50" />
            )}

            {/* Overlay — darkens + gold tint on hover */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent transition-all duration-500 group-hover:from-black/80 group-hover:via-black/30" />

            {/* Gold accent line on hover */}
            <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-brand-gold scale-x-0 transition-transform duration-500 ease-out origin-left rtl:origin-right group-hover:scale-x-100" />

            {/* Content */}
            <div className="absolute inset-0 flex flex-col justify-end p-5 sm:p-6">
              <h3 className="text-xl sm:text-2xl font-bold text-white leading-tight transition-transform duration-300 group-hover:-translate-y-1">
                {name}
              </h3>
              <div className="flex items-center gap-1.5 mt-2 text-white/70 text-sm opacity-0 translate-y-3 transition-all duration-300 group-hover:opacity-100 group-hover:translate-y-0">
                <span>{t('cta')}</span>
                <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1 rtl:group-hover:-translate-x-1 rtl:rotate-180" />
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
