import { useQuery } from '@tanstack/react-query'
import { useLocale } from 'next-intl'
import { api } from '@/lib/api'

export interface Category {
  id: string
  parentId?: string | null
  slug: string
  isActive?: boolean           // Admin variant sets this; public endpoint omits
  imageUrl?: string
  iconKey?: string | null
  googleCategoryId?: string | null
  googleCategoryLabel?: string | null
  ebayCategoryId?: string | null
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

/**
 * Admin variant of useCategories — hits /admin/categories which returns
 * the FULL translations array for each category (de + en + ar), not
 * filtered to a single language. Use this in admin UIs (category
 * pickers on the product edit + list pages) where the dropdown needs
 * to render the category name in the viewing admin's locale with a
 * graceful fallback chain when a translation is missing.
 *
 * Tree shape (parents with .children[]) is identical to useCategories(),
 * so the same cascading dropdown logic works.
 *
 * Commit 3: accepts optional { includeArchived } to support the admin
 * "Show archived" toggle and the reactivate flow.
 */
export function useAdminCategories(options?: { includeArchived?: boolean }) {
  const includeArchived = options?.includeArchived === true
  return useQuery<Category[]>({
    queryKey: ['admin-categories-full', includeArchived],
    queryFn: async () => {
      const { data } = await api.get('/admin/categories', {
        params: includeArchived ? { includeArchived: 'true' } : {},
      })
      return Array.isArray(data) ? data : data?.data ?? data?.items ?? []
    },
    staleTime: 5 * 60 * 1000,
  })
}
