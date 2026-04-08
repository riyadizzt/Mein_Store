'use client'

import { Suspense } from 'react'
import { useLocale } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { Flame, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useActiveCampaign } from '@/hooks/use-campaign'
import { ProductCard, ProductCardSkeleton } from '@/components/product/product-card'
import { CampaignHero } from '@/components/home/campaign-hero'

const COPY = {
  de: { title: 'Sale', subtitle: 'Entdecke unsere reduzierten Artikel', empty: 'Aktuell keine Sale-Artikel verfügbar', loading: 'Lade Sale-Produkte...' },
  en: { title: 'Sale', subtitle: 'Discover our discounted items', empty: 'No sale items available right now', loading: 'Loading sale products...' },
  ar: { title: 'تخفيضات', subtitle: 'اكتشف منتجاتنا المخفضة', empty: 'لا توجد منتجات مخفضة حالياً', loading: 'جاري تحميل المنتجات...' },
}

function SaleContent() {
  const locale = useLocale() as 'de' | 'en' | 'ar'
  const copy = COPY[locale] ?? COPY.de
  const { campaign } = useActiveCampaign()

  // Fetch products that have a sale price (salePrice < basePrice)
  const { data, isLoading } = useQuery({
    queryKey: ['sale-products', locale],
    queryFn: async () => {
      const { data } = await api.get('/products', { params: { lang: locale, limit: 40 } })
      return data
    },
  })

  const allProducts = data?.items ?? data?.data ?? (Array.isArray(data) ? data : [])
  // Filter to only sale products
  const saleProducts = allProducts.filter((p: any) => p.salePrice && Number(p.salePrice) < Number(p.basePrice))

  return (
    <div>
      {/* Campaign Hero if active */}
      {campaign?.heroBannerEnabled ? (
        <CampaignHero campaign={campaign} locale={locale} />
      ) : (
        <div className="bg-gradient-to-br from-[#1a1a2e] to-[#d4a853]/20 py-16 sm:py-24 text-center">
          <Flame className="h-10 w-10 text-[#d4a853] mx-auto mb-4" />
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-display font-bold text-white">{copy.title}</h1>
          <p className="mt-3 text-white/60 text-lg">{copy.subtitle}</p>
        </div>
      )}

      {/* Products Grid */}
      <div className="mx-auto max-w-7xl px-6 sm:px-8 lg:px-12 py-12">
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 lg:gap-6">
            {Array.from({ length: 8 }).map((_, i) => <ProductCardSkeleton key={i} />)}
          </div>
        ) : saleProducts.length === 0 ? (
          <div className="text-center py-20">
            <Flame className="h-16 w-16 text-muted-foreground/20 mx-auto mb-4" />
            <p className="text-lg font-medium">{copy.empty}</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-6">{saleProducts.length} {locale === 'ar' ? 'منتج' : locale === 'en' ? 'products' : 'Produkte'}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 lg:gap-6">
              {saleProducts.map((product: any) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function SalePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-gold" /></div>}>
      <SaleContent />
    </Suspense>
  )
}
