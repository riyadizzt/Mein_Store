'use client'

import { useRef } from 'react'
import { useLocale } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import Image from 'next/image'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import { getImageUrl } from '@/lib/imagekit'

interface Props {
  productId?: string
  categoryId?: string
  title?: string
  limit?: number
}

export function ProductRecommendations({ productId, categoryId, title, limit = 8 }: Props) {
  const locale = useLocale()
  const scrollRef = useRef<HTMLDivElement>(null)
  const t = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d
  const defaultTitle = t('Das könnte dir auch gefallen', 'You might also like', 'قد يعجبك أيضاً')

  const { data: products, isLoading } = useQuery({
    queryKey: ['recommendations', productId, categoryId, limit],
    queryFn: async () => {
      const params: Record<string, string> = { limit: String(limit) }
      if (categoryId) params.categoryId = categoryId
      if (productId) params.excludeId = productId
      const { data } = await api.get('/products', { params })
      return (data?.data ?? data ?? []) as any[]
    },
    enabled: !!(productId || categoryId),
  })

  if (isLoading || !products?.length) return null

  const scroll = (dir: 'left' | 'right') => {
    if (!scrollRef.current) return
    const amount = 280
    scrollRef.current.scrollBy({ left: dir === 'right' ? amount : -amount, behavior: 'smooth' })
  }

  const getName = (p: any) => {
    const trans = p.translations ?? p.productTranslations ?? []
    const t = trans.find((t: any) => t.language === locale) ?? trans[0]
    return t?.name ?? p.name ?? ''
  }

  const getPrice = (p: any) => {
    const sale = p.salePrice ? Number(p.salePrice) : null
    const base = Number(p.basePrice ?? 0)
    return { base, sale }
  }

  const getImage = (p: any) => {
    const img = p.images?.[0]?.url ?? p.image ?? ''
    return getImageUrl(img, { width: 400, height: 400 })
  }

  return (
    <section className="py-8">
      <div className="flex items-center justify-between mb-4 px-1">
        <h2 className="text-lg font-bold">{title ?? defaultTitle}</h2>
        <div className="flex gap-1">
          <button onClick={() => scroll('left')} className="h-8 w-8 rounded-full border flex items-center justify-center hover:bg-muted transition-colors">
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
          </button>
          <button onClick={() => scroll('right')} className="h-8 w-8 rounded-full border flex items-center justify-center hover:bg-muted transition-colors">
            <ChevronRight className="h-4 w-4 rtl:rotate-180" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex gap-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-2 -mx-1 px-1">
        {products.map((p: any) => {
          const { base, sale } = getPrice(p)
          const slug = p.slug ?? p.id
          return (
            <Link
              key={p.id}
              href={`/${locale}/products/${slug}`}
              className="flex-shrink-0 w-[200px] sm:w-[220px] snap-start group"
            >
              <div className="relative aspect-square rounded-xl overflow-hidden bg-muted mb-2">
                {getImage(p) ? (
                  <Image
                    src={getImage(p)}
                    alt={getName(p)}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                    sizes="220px"
                  />
                ) : (
                  <div className="w-full h-full bg-muted flex items-center justify-center text-muted-foreground text-xs">
                    {getName(p).slice(0, 2)}
                  </div>
                )}
                {sale && sale < base && (
                  <div className="absolute top-2 ltr:left-2 rtl:right-2 px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold">
                    -{Math.round((1 - sale / base) * 100)}%
                  </div>
                )}
              </div>
              <h3 className="text-sm font-medium truncate group-hover:text-[#d4a853] transition-colors">{getName(p)}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                {sale && sale < base ? (
                  <>
                    <span className="text-sm font-bold text-red-600">€{sale.toFixed(2)}</span>
                    <span className="text-xs text-muted-foreground line-through">€{base.toFixed(2)}</span>
                  </>
                ) : (
                  <span className="text-sm font-bold">€{base.toFixed(2)}</span>
                )}
              </div>
            </Link>
          )
        })}
      </div>

      <style>{`.scrollbar-hide::-webkit-scrollbar { display: none } .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }`}</style>
    </section>
  )
}
