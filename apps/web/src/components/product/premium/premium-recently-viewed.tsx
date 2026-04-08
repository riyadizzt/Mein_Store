'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ShoppingBag } from 'lucide-react'

export interface RecentProduct {
  id: string
  slug: string
  name: string
  imageUrl: string
  price: number
}

const STORAGE_KEY = 'malak-recently-viewed'
const MAX_ITEMS = 8

export function saveRecentlyViewed(product: RecentProduct) {
  if (typeof window === 'undefined') return
  try {
    const existing: RecentProduct[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    const filtered = existing.filter(p => p.id !== product.id)
    filtered.unshift(product)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered.slice(0, MAX_ITEMS)))
  } catch { /* ignore */ }
}

function getRecentlyViewed(): RecentProduct[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch { return [] }
}

interface Props {
  currentProductId: string
  locale: string
}

export function PremiumRecentlyViewed({ currentProductId, locale }: Props) {
  const [products, setProducts] = useState<RecentProduct[]>([])
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  useEffect(() => {
    setProducts(getRecentlyViewed().filter(p => p.id !== currentProductId).slice(0, 6))
  }, [currentProductId])

  if (products.length === 0) return null

  return (
    <section className="py-16 border-t border-[#e5e5e5]">
      <h2 className={`text-[#0f1419]/50 mb-10 ${locale === 'ar' ? 'text-lg font-semibold' : 'text-base tracking-[0.08em] uppercase'}`}>
        {t3('Zuletzt angesehen', 'Recently Viewed', 'شوهدت مؤخراً')}
      </h2>
      <div className="flex gap-5 overflow-x-auto scrollbar-hide pb-2 -mx-4 px-4 lg:mx-0 lg:px-0">
        {products.map(p => (
          <div key={p.id} className="flex-shrink-0 w-[170px] sm:w-[200px] group relative">
            <Link href={`/${locale}/products/${p.slug}`}>
              <div className="relative aspect-[3/4] bg-[#f5f5f5] overflow-hidden mb-3 flex items-center justify-center">
                {p.imageUrl ? (
                  <img
                    src={p.imageUrl}
                    alt={p.name}
                    className="w-full h-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1)] group-hover:scale-[1.03]"
                    loading="lazy"
                  />
                ) : (
                  <div className="h-12 w-12 rounded-full bg-[#e8e8e8] flex items-center justify-center">
                    <span className="text-lg font-light text-[#b0b0b0] select-none">{(p.name ?? '?').charAt(0).toUpperCase()}</span>
                  </div>
                )}

                {/* Quick-Add → navigates to PDP for variant selection */}
                <div className="absolute bottom-0 left-0 right-0 h-10 bg-[#0f1419]/90 backdrop-blur-sm text-white text-[13px] font-medium flex items-center justify-center gap-2 transition-all duration-300 lg:opacity-0 lg:group-hover:opacity-100 lg:translate-y-full lg:group-hover:translate-y-0">
                  <ShoppingBag className="h-3.5 w-3.5" strokeWidth={1.5} />
                  {t3('Ansehen', 'View', 'عرض')}
                </div>
              </div>
              <p className="text-sm text-[#0f1419] truncate leading-snug">{p.name}</p>
              <p className="text-sm font-semibold text-[#0f1419]/60 mt-1 tabular-nums">&euro;{p.price.toFixed(2)}</p>
            </Link>
          </div>
        ))}
      </div>
    </section>
  )
}
