'use client'

import { useFeaturedProducts } from '@/hooks/use-products'
import { ProductCard, ProductCardSkeleton } from './product-card'

interface ProductScrollProps {
  title: string
  sort: 'bestseller' | 'newest'
}

export function ProductScroll({ title, sort }: ProductScrollProps) {
  const { data: products, isLoading, isError } = useFeaturedProducts(sort)

  if (isError) return null // Graceful: hide section if API unreachable

  return (
    <div>
      <h2 className="text-xl sm:text-2xl font-bold mb-4">{title}</h2>
      <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide -mx-4 px-4">
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex-shrink-0 w-[200px] sm:w-[240px] snap-start">
                <ProductCardSkeleton />
              </div>
            ))
          : products?.map((product, i) => (
              <div key={product.id} className="flex-shrink-0 w-[200px] sm:w-[240px] snap-start">
                <ProductCard product={product} priority={i < 4} />
              </div>
            ))}
      </div>
    </div>
  )
}
