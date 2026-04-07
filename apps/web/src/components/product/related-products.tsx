'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ProductCard, ProductCardSkeleton } from '@/components/product/product-card'

interface Props {
  productId: string
  categoryId?: string
  locale: string
}

export function RelatedProducts({ productId, categoryId, locale }: Props) {
  const t = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  const { data, isLoading } = useQuery({
    queryKey: ['related-products', productId, categoryId],
    queryFn: async () => {
      const params: Record<string, string> = { limit: '4' }
      if (categoryId) params.categoryId = categoryId
      const { data } = await api.get('/products', { params })
      const items = data?.items ?? data ?? []
      // Exclude current product
      return items.filter((p: any) => p.id !== productId).slice(0, 4)
    },
    staleTime: 60000,
  })

  const products = data ?? []
  if (!isLoading && products.length === 0) return null

  return (
    <div className="mt-12">
      <h2 className="text-lg font-bold mb-6">{t('Das könnte dir auch gefallen', 'You might also like', 'قد يعجبك أيضاً')}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => <ProductCardSkeleton key={i} />)
          : products.map((product: any) => <ProductCard key={product.id} product={product} />)
        }
      </div>
    </div>
  )
}
