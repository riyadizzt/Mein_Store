'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale } from 'next-intl'
import { api } from '@/lib/api'

/**
 * Debounced instant search hook.
 * - 300ms debounce after last keystroke
 * - Minimum 2 characters
 * - Returns products from /products/search?q=...
 */
export function useInstantSearch(query: string) {
  const locale = useLocale()
  const [debouncedQuery, setDebouncedQuery] = useState('')

  // Debounce 300ms
  useEffect(() => {
    if (query.trim().length < 2) {
      setDebouncedQuery('')
      return
    }
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])

  const { data, isLoading, isError } = useQuery({
    queryKey: ['instant-search', debouncedQuery, locale],
    queryFn: async () => {
      const { data } = await api.get('/products/search', {
        params: { q: debouncedQuery, lang: locale, limit: 6 },
      })
      return data
    },
    enabled: debouncedQuery.length >= 2,
    staleTime: 30000, // 30s cache for same query
  })

  const products = data?.items ?? data?.data ?? (Array.isArray(data) ? data : [])
  const total = data?.meta?.total ?? data?.total ?? products.length

  return {
    products,
    total,
    isLoading: debouncedQuery.length >= 2 && isLoading,
    isError,
    hasQuery: debouncedQuery.length >= 2,
  }
}
