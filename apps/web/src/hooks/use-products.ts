import { useQuery, useInfiniteQuery } from '@tanstack/react-query'
import { useLocale } from 'next-intl'
import { api } from '@/lib/api'

export interface Product {
  id: string
  slug: string
  basePrice: number
  salePrice: number | null
  taxRate: number
  isActive: boolean
  translations: Array<{ language: string; name: string; description?: string }>
  variants: Array<{
    id: string
    sku: string
    color?: string
    size?: string
    isActive: boolean
  }>
  images: Array<{ url: string; altText?: string; isPrimary: boolean; sortOrder: number }>
  category?: { slug: string; translations: Array<{ language: string; name: string }> }
  _stock?: { available: number }
}

export interface ProductsResponse {
  items: Product[]
  nextCursor: string | null
  hasNextPage: boolean
}

interface ProductsQueryParams {
  category?: string
  categoryId?: string
  gender?: string
  sort?: string
  minPrice?: number
  maxPrice?: number
  inStock?: boolean
  search?: string
  limit?: number
  // Comma-separated lists, sent verbatim to the backend.
  colors?: string
  sizes?: string
}

export interface ProductFilterOptions {
  colors: { name: string; hex: string | null }[]
  sizes: string[]
}

export function useProductFilterOptions(categoryId?: string) {
  return useQuery<ProductFilterOptions>({
    queryKey: ['products', 'filter-options', categoryId],
    queryFn: async () => {
      const { data } = await api.get('/products/filter-options', {
        params: categoryId ? { categoryId } : undefined,
      })
      return data ?? { colors: [], sizes: [] }
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function useProducts(params: ProductsQueryParams = {}) {
  const lang = useLocale()
  return useInfiniteQuery<ProductsResponse>({
    queryKey: ['products', params, lang],
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get('/products', {
        params: {
          ...params,
          lang,
          page: pageParam || 1,
          limit: params.limit ?? 20,
        },
      })
      // Normalize API response format
      if (Array.isArray(data)) {
        return { items: data, nextCursor: null, hasNextPage: false }
      }
      const items = data.items ?? data.data ?? []
      const meta = data.meta
      const currentPage = meta?.page ?? 1
      const totalPages = meta?.totalPages ?? 1
      const hasMore = currentPage < totalPages
      return {
        items,
        nextCursor: hasMore ? String(currentPage + 1) : null,
        hasNextPage: hasMore,
      }
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage?.nextCursor,
  })
}

export function useProduct(slug: string) {
  return useQuery<Product>({
    queryKey: ['product', slug],
    queryFn: async () => {
      const { data } = await api.get(`/products/${slug}`)
      return data
    },
    enabled: !!slug,
  })
}

export function useFeaturedProducts(sort: 'bestseller' | 'newest', limit = 10) {
  const lang = useLocale()
  return useQuery<Product[]>({
    queryKey: ['products', 'featured', sort, lang],
    queryFn: async () => {
      const { data } = await api.get('/products', {
        params: { sort, limit, lang },
      })
      return data?.items ?? data?.data ?? (Array.isArray(data) ? data : [])
    },
    staleTime: 5 * 60 * 1000, // 5 min
  })
}
