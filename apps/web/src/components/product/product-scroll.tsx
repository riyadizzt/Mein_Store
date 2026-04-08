'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { useLocale } from 'next-intl'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useFeaturedProducts } from '@/hooks/use-products'
import { ProductCard, ProductCardSkeleton } from './product-card'

interface ProductScrollProps {
  title: string
  sort: 'bestseller' | 'newest'
}

export function ProductScroll({ title, sort }: ProductScrollProps) {
  const locale = useLocale()
  const isRTL = locale === 'ar'
  const { data: products, isLoading, isError } = useFeaturedProducts(sort)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const checkScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    const atStart = Math.abs(scrollLeft) < 4
    const atEnd = Math.abs(scrollLeft) + clientWidth >= scrollWidth - 4
    // In RTL, scrollLeft is negative in some browsers
    setCanScrollLeft(isRTL ? !atEnd : !atStart)
    setCanScrollRight(isRTL ? !atStart : !atEnd)
  }, [isRTL])

  useEffect(() => {
    checkScroll()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', checkScroll, { passive: true })
    const ro = new ResizeObserver(checkScroll)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', checkScroll)
      ro.disconnect()
    }
  }, [checkScroll, products])

  const scroll = useCallback(
    (direction: 'left' | 'right') => {
      const el = scrollRef.current
      if (!el) return
      const cardWidth = el.querySelector(':scope > div')?.clientWidth ?? 240
      const amount = cardWidth * 2 + 16 // 2 cards + gap
      const sign = direction === 'left' ? -1 : 1
      el.scrollBy({ left: sign * amount, behavior: 'smooth' })
    },
    [],
  )

  if (isError) return null

  return (
    <div className="group/scroll relative">
      {/* Section header with gold accent */}
      <div className="flex items-center gap-3 mb-5">
        <div className="h-6 w-[3px] rounded-full bg-brand-gold" />
        <h2 className="text-xl sm:text-2xl font-bold">{title}</h2>
      </div>

      {/* Scroll container */}
      <div className="relative">
        {/* Left arrow */}
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="absolute left-0 rtl:left-auto rtl:right-0 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full bg-white/90 backdrop-blur-sm shadow-elevated flex items-center justify-center opacity-0 group-hover/scroll:opacity-100 transition-opacity duration-200 hover:bg-white hover:scale-105 -translate-x-1/2 rtl:translate-x-1/2"
            aria-label="Scroll left"
          >
            <ChevronLeft className="h-5 w-5 rtl:rotate-180" />
          </button>
        )}

        {/* Right arrow */}
        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="absolute right-0 rtl:right-auto rtl:left-0 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full bg-white/90 backdrop-blur-sm shadow-elevated flex items-center justify-center opacity-0 group-hover/scroll:opacity-100 transition-opacity duration-200 hover:bg-white hover:scale-105 translate-x-1/2 rtl:-translate-x-1/2"
            aria-label="Scroll right"
          >
            <ChevronRight className="h-5 w-5 rtl:rotate-180" />
          </button>
        )}

        {/* Cards row */}
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide -mx-4 px-4 scroll-mask"
        >
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex-shrink-0 w-[200px] sm:w-[240px] snap-start"
                >
                  <ProductCardSkeleton />
                </div>
              ))
            : products?.map((product, i) => (
                <div
                  key={product.id}
                  className="flex-shrink-0 w-[200px] sm:w-[240px] snap-start"
                >
                  <ProductCard product={product} priority={i < 4} />
                </div>
              ))}
        </div>
      </div>
    </div>
  )
}
