'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useLocale } from 'next-intl'
import { Search, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ProductCard, ProductCardSkeleton } from '@/components/product/product-card'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { addToSearchHistory } from '@/lib/search-history'
import { useEffect } from 'react'

const COPY = {
  de: { resultsFor: 'Ergebnisse für', noResults: 'Keine Ergebnisse', noResultsHint: 'Versuche einen anderen Suchbegriff oder stöbere in unserem Sortiment.', browseAll: 'Alle Produkte ansehen', search: 'Suche' },
  en: { resultsFor: 'Results for', noResults: 'No results', noResultsHint: 'Try a different search term or browse our collection.', browseAll: 'Browse all products', search: 'Search' },
  ar: { resultsFor: 'نتائج البحث عن', noResults: 'لا توجد نتائج', noResultsHint: 'جرّب كلمة بحث مختلفة أو تصفح مجموعتنا.', browseAll: 'تصفح كل المنتجات', search: 'بحث' },
}

function SearchContent() {
  const locale = useLocale() as 'de' | 'en' | 'ar'
  const copy = COPY[locale] ?? COPY.de
  const searchParams = useSearchParams()
  const q = searchParams.get('q') ?? ''

  // Save to history on page load
  useEffect(() => {
    if (q.trim()) addToSearchHistory(q.trim())
  }, [q])

  const { data, isLoading } = useQuery({
    queryKey: ['search-page', q, locale],
    queryFn: async () => {
      const { data } = await api.get('/products/search', {
        params: { q, lang: locale, limit: 40 },
      })
      return data
    },
    enabled: q.trim().length >= 2,
    staleTime: 30000,
  })

  const products = data?.items ?? data?.data ?? (Array.isArray(data) ? data : [])
  const total = data?.meta?.total ?? data?.total ?? products.length

  if (!q.trim()) {
    return (
      <div className="text-center py-20">
        <Search className="h-16 w-16 text-muted-foreground/20 mx-auto mb-4" />
        <p className="text-lg font-medium">{copy.search}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-6 sm:px-8 lg:px-12 py-8 sm:py-12">
      {/* Header */}
      <div className="mb-8">
        <p className="text-sm text-muted-foreground">{copy.resultsFor}</p>
        <h1 className="text-2xl sm:text-3xl font-display font-bold mt-1">&ldquo;{q}&rdquo;</h1>
        {!isLoading && <p className="text-sm text-muted-foreground mt-2">{total} {locale === 'ar' ? 'نتيجة' : locale === 'en' ? 'results' : 'Ergebnisse'}</p>}
      </div>

      {/* Loading */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 lg:gap-6">
          {Array.from({ length: 8 }).map((_, i) => <ProductCardSkeleton key={i} />)}
        </div>
      ) : products.length === 0 ? (
        /* No Results */
        <div className="text-center py-20">
          <div className="h-20 w-20 rounded-full bg-brand-gold/10 flex items-center justify-center mx-auto mb-5">
            <Search className="h-9 w-9 text-brand-gold/40" />
          </div>
          <h2 className="text-lg font-semibold mb-2">{copy.noResults}</h2>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6">{copy.noResultsHint}</p>
          <Link href={`/${locale}/products`}>
            <Button className="btn-press">{copy.browseAll}</Button>
          </Link>
        </div>
      ) : (
        /* Results Grid */
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 lg:gap-6">
          {products.map((product: any) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-brand-gold" />
      </div>
    }>
      <SearchContent />
    </Suspense>
  )
}
