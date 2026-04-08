'use client'

import { useState, useRef, useEffect } from 'react'
import { useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { Search, X, Clock, ArrowRight, Trash2 } from 'lucide-react'
import { useInstantSearch } from '@/hooks/use-search'
import { getSearchHistory, addToSearchHistory, clearSearchHistory } from '@/lib/search-history'
import { trackEvent } from '@/lib/posthog'
import { motion } from 'motion/react'

const COPY = {
  de: { placeholder: 'Kleidung, Schuhe suchen...', recent: 'Letzte Suchen', clearHistory: 'Verlauf löschen', allResults: 'Alle Ergebnisse anzeigen', noResults: 'Keine Ergebnisse für', tryOther: 'Versuche einen anderen Suchbegriff' },
  en: { placeholder: 'Search clothing, shoes...', recent: 'Recent searches', clearHistory: 'Clear history', allResults: 'View all results', noResults: 'No results for', tryOther: 'Try a different search term' },
  ar: { placeholder: 'ابحث عن ملابس، أحذية...', recent: 'عمليات البحث الأخيرة', clearHistory: 'مسح السجل', allResults: 'عرض كل النتائج', noResults: 'لا توجد نتائج لـ', tryOther: 'جرّب كلمة بحث مختلفة' },
}

interface SearchOverlayProps {
  open: boolean
  onClose: () => void
}

export function SearchOverlay({ open, onClose }: SearchOverlayProps) {
  const locale = useLocale() as 'de' | 'en' | 'ar'
  const copy = COPY[locale] ?? COPY.de
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const { products, total, isLoading, hasQuery } = useInstantSearch(query)

  useEffect(() => {
    if (open) {
      setHistory(getSearchHistory())
      setTimeout(() => inputRef.current?.focus(), 100)
    } else {
      setQuery('')
    }
  }, [open])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    addToSearchHistory(query.trim())
    trackEvent('Search', { query: query.trim() })
    router.push(`/${locale}/search?q=${encodeURIComponent(query.trim())}`)
    onClose()
  }

  const handleHistoryClick = (term: string) => {
    setQuery(term)
    addToSearchHistory(term)
    router.push(`/${locale}/search?q=${encodeURIComponent(term)}`)
    onClose()
  }

  const handleClearHistory = () => {
    clearSearchHistory()
    setHistory([])
  }

  const getName = (p: any) =>
    p.name ?? p.translations?.find((t: any) => t.language === locale)?.name ?? p.translations?.[0]?.name ?? p.slug

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Search Panel */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
        className="fixed top-0 left-0 right-0 z-[101] bg-background shadow-elevated"
      >
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-4">
          {/* Search Input */}
          <form onSubmit={handleSubmit} className="relative">
            <Search className="absolute left-4 rtl:left-auto rtl:right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={copy.placeholder}
              className="w-full h-12 pl-12 rtl:pl-12 rtl:pr-12 pr-12 rounded-xl border bg-muted/30 text-base focus:outline-none focus:ring-2 focus:ring-brand-gold/30 focus:border-brand-gold/40 transition-all"
              autoComplete="off"
            />
            <button type="button" onClick={onClose} className="absolute right-3 rtl:right-auto rtl:left-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg hover:bg-muted transition-colors">
              <X className="h-4 w-4" />
            </button>
          </form>

          {/* Results Dropdown */}
          <div className="mt-3 max-h-[70vh] overflow-y-auto">
            {/* Loading */}
            {isLoading && (
              <div className="space-y-3 py-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex gap-3 animate-pulse">
                    <div className="h-14 w-14 rounded-lg bg-muted flex-shrink-0" />
                    <div className="flex-1 space-y-2 py-1"><div className="h-3 bg-muted rounded w-3/4" /><div className="h-3 bg-muted rounded w-1/3" /></div>
                  </div>
                ))}
              </div>
            )}

            {/* Product Results */}
            {!isLoading && hasQuery && products.length > 0 && (
              <div className="py-3">
                {products.slice(0, 6).map((product: any) => {
                  const name = getName(product)
                  const price = product.salePrice ?? product.basePrice
                  const image = product.imageUrl ?? product.images?.[0]?.url
                  return (
                    <Link
                      key={product.id}
                      href={`/${locale}/products/${product.slug}`}
                      onClick={() => { addToSearchHistory(query.trim()); onClose() }}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/50 transition-colors group"
                    >
                      <div className="h-14 w-14 rounded-lg bg-muted overflow-hidden flex-shrink-0">
                        {image && <Image src={image} alt={name} width={56} height={56} className="h-full w-full object-cover" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate group-hover:text-brand-gold transition-colors">{name}</p>
                        <p className="text-sm font-bold tabular-nums mt-0.5">&euro;{Number(price).toFixed(2)}</p>
                      </div>
                    </Link>
                  )
                })}

                {total > 6 && (
                  <button
                    onClick={handleSubmit}
                    className="w-full mt-2 px-3 py-3 text-sm font-medium text-brand-gold hover:bg-brand-gold/5 rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    {copy.allResults} ({total})
                    <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                  </button>
                )}
              </div>
            )}

            {/* No Results */}
            {!isLoading && hasQuery && products.length === 0 && (
              <div className="py-8 text-center">
                <Search className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm font-medium">{copy.noResults} &ldquo;{query}&rdquo;</p>
                <p className="text-xs text-muted-foreground mt-1">{copy.tryOther}</p>
              </div>
            )}

            {/* Search History (when empty input) */}
            {!hasQuery && history.length > 0 && (
              <div className="py-3">
                <div className="flex items-center justify-between px-3 mb-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{copy.recent}</span>
                  <button onClick={handleClearHistory} className="text-xs text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1">
                    <Trash2 className="h-3 w-3" />
                    {copy.clearHistory}
                  </button>
                </div>
                {history.map((term) => (
                  <button
                    key={term}
                    onClick={() => handleHistoryClick(term)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/50 transition-colors text-sm text-start"
                  >
                    <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    {term}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </>
  )
}
