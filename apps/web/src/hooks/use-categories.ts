import { useQuery } from '@tanstack/react-query'
import { useLocale } from 'next-intl'
import { api } from '@/lib/api'

export interface Category {
  id: string
  slug: string
  imageUrl?: string
  sortOrder: number
  name?: string
  children?: Category[]
  translations: Array<{ language: string; name: string; description?: string }>
  _count?: { products: number }
}

export function useCategories() {
  const locale = useLocale()
  return useQuery<Category[]>({
    queryKey: ['categories', locale],
    queryFn: async () => {
      const { data } = await api.get('/categories', { params: { lang: locale } })
      return Array.isArray(data) ? data : data?.data ?? data?.items ?? []
    },
    staleTime: 5 * 60 * 1000,
  })
}
