'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { useLocale } from 'next-intl'
import { ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { useFeaturedProducts } from '@/hooks/use-products'
import { ProductCard, ProductCardSkeleton } from '@/components/product/product-card'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(ScrollTrigger)

interface FeaturedProductsProps {
  title: string
  eyebrow: string
  sort: 'bestseller' | 'newest'
  locale: string
  bgClass?: string
}

export function FeaturedProducts({ title, eyebrow, sort, locale, bgClass = '' }: FeaturedProductsProps) {
  const currentLocale = useLocale()
  const isRTL = currentLocale === 'ar'
  const { data: products, isLoading, isError } = useFeaturedProducts(sort)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const checkScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    const atStart = Math.abs(scrollLeft) < 4
    const atEnd = Math.abs(scrollLeft) + clientWidth >= scrollWidth - 4
    setCanLeft(isRTL ? !atEnd : !atStart)
    setCanRight(isRTL ? !atStart : !atEnd)
  }, [isRTL])

  useEffect(() => {
    checkScroll()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', checkScroll, { passive: true })
    const ro = new ResizeObserver(checkScroll)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', checkScroll); ro.disconnect() }
  }, [checkScroll, products])

  const scroll = useCallback((dir: 'left' | 'right') => {
    const el = scrollRef.current
    if (!el) return
    const cardW = el.querySelector(':scope > div')?.clientWidth ?? 260
    el.scrollBy({ left: (dir === 'left' ? -1 : 1) * (cardW * 2 + 16), behavior: 'smooth' })
  }, [])

  useGSAP(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) return

    gsap.from('[data-section-header]', {
      y: 30, opacity: 0, duration: 0.6, ease: 'power3.out',
      scrollTrigger: { trigger: sectionRef.current, start: 'top 80%', once: true },
    })
  }, { scope: sectionRef })

  if (isError) return null

  return (
    <section ref={sectionRef} aria-label={title} className={`py-20 sm:py-28 ${bgClass}`}>
      <div className="mx-auto max-w-[1440px] px-6 sm:px-8 lg:px-12">
        {/* Section header */}
        <div data-section-header className="flex items-end justify-between mb-10">
          <div>
            <p className="text-brand-gold text-sm font-medium tracking-[0.2em] uppercase mb-2">{eyebrow}</p>
            <h2 className="text-3xl sm:text-4xl font-display font-bold">{title}</h2>
          </div>
          <div className="flex items-center gap-3">
            {/* Desktop arrows */}
            <div className="hidden sm:flex items-center gap-2">
              <button
                onClick={() => scroll('left')}
                disabled={!canLeft}
                className="h-10 w-10 rounded-full border flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-20 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 outline-none"
                aria-label="Previous"
              >
                <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
              </button>
              <button
                onClick={() => scroll('right')}
                disabled={!canRight}
                className="h-10 w-10 rounded-full border flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-20 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 outline-none"
                aria-label="Next"
              >
                <ChevronRight className="h-4 w-4 rtl:rotate-180" />
              </button>
            </div>
            <Link
              href={`/${locale}/products?sort=${sort}`}
              className="hidden sm:flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {currentLocale === 'ar' ? 'عرض الكل' : currentLocale === 'en' ? 'View all' : 'Alle ansehen'}
              <ArrowRight className="h-4 w-4 rtl:rotate-180" />
            </Link>
          </div>
        </div>

        {/* Product scroll */}
        <div
          ref={scrollRef}
          className="flex gap-4 lg:gap-5 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide -mx-6 px-6 sm:-mx-8 sm:px-8 lg:mx-0 lg:px-0"
        >
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex-shrink-0 w-[200px] sm:w-[240px] lg:w-[260px] snap-start">
                  <ProductCardSkeleton />
                </div>
              ))
            : products?.map((product, i) => (
                <div key={product.id} className="flex-shrink-0 w-[200px] sm:w-[240px] lg:w-[260px] snap-start">
                  <ProductCard product={product} priority={i < 4} />
                </div>
              ))}
        </div>

        {/* Mobile "view all" link */}
        <div className="mt-6 text-center sm:hidden">
          <Link
            href={`/${locale}/products?sort=${sort}`}
            className="inline-flex items-center gap-2 text-sm font-medium text-brand-gold"
          >
            {currentLocale === 'ar' ? 'عرض الكل' : currentLocale === 'en' ? 'View all' : 'Alle ansehen'}
            <ArrowRight className="h-4 w-4 rtl:rotate-180" />
          </Link>
        </div>
      </div>
    </section>
  )
}
