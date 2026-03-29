'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, PackageSearch } from 'lucide-react'
import { useProducts } from '@/hooks/use-products'
import { useCategories } from '@/hooks/use-categories'
import { ProductCard, ProductCardSkeleton } from '@/components/product/product-card'
import { FilterSidebar } from '@/components/product/filter-sidebar'
import { Button } from '@/components/ui/button'

function ProductsContent() {
  const t = useTranslations('product')
  const tErrors = useTranslations('errors')
  const searchParams = useSearchParams()
  const { data: categories } = useCategories()

  // Resolve department slug to categoryId
  const departmentSlug = searchParams.get('department') ?? undefined
  const departmentCategory = departmentSlug ? (categories ?? []).find((c) => c.slug === departmentSlug) : undefined
  const subCategorySlug = searchParams.get('category') ?? undefined
  const subCategory = subCategorySlug && departmentCategory
    ? (departmentCategory as any).children?.find((c: any) => c.slug === subCategorySlug)
    : undefined

  const params = {
    categoryId: subCategory?.id ?? departmentCategory?.id ?? undefined,
    sort: searchParams.get('sort') ?? undefined,
    minPrice: searchParams.get('minPrice') ? Number(searchParams.get('minPrice')) : undefined,
    maxPrice: searchParams.get('maxPrice') ? Number(searchParams.get('maxPrice')) : undefined,
    inStock: searchParams.get('inStock') === 'true' ? true : undefined,
    search: searchParams.get('q') ?? undefined,
  }

  const {
    data,
    isLoading,
    isError,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useProducts(params)

  const allProducts = data?.pages.flatMap((page) => page.items ?? page ?? []) ?? []

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-start gap-8">
        {/* Filter Sidebar */}
        <FilterSidebar />

        {/* Product Grid */}
        <div className="flex-1 min-w-0">
          {/* Mobile filter button + result count */}
          <div className="flex items-center justify-between mb-6 lg:mb-0 lg:hidden">
            <p className="text-sm text-muted-foreground">
              {t('filter.products', { count: allProducts.length })}
            </p>
          </div>

          {/* Loading / Error */}
          {isError ? (
            <div className="text-center py-16">
              <p className="text-muted-foreground">{tErrors('generic')}</p>
            </div>
          ) : isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 lg:gap-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </div>
          ) : allProducts.length === 0 ? (
            /* Empty State */
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <PackageSearch className="h-16 w-16 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-medium mb-2">{t('noProducts')}</h3>
              <p className="text-sm text-muted-foreground mb-6">
                {t('tryOtherFilters')}
              </p>
              <Button
                variant="outline"
                onClick={() => window.history.pushState(null, '', window.location.pathname)}
              >
                {t('resetFilters')}
              </Button>
            </div>
          ) : (
            <>
              {/* Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 lg:gap-6">
                {allProducts.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>

              {/* Load More */}
              {hasNextPage && (
                <div className="mt-8 flex justify-center">
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                  >
                    {isFetchingNextPage ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {t('loading')}
                      </>
                    ) : (
                      t('loadMore')
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ProductsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 lg:gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        </div>
      }
    >
      <ProductsContent />
    </Suspense>
  )
}
