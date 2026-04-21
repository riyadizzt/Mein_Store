'use client'

/**
 * Google Product Taxonomy searchable dropdown (C6).
 *
 * Renders a combobox-style picker for the ~5600 Google Product
 * Categories. Data bundled at /taxonomy/google-product-categories.json
 * (~1 MB, lazy-fetched on first open).
 *
 * Presentation: admin types a fragment ("hemd", "shirt", "shoe"),
 * component filters client-side and shows up to 50 matches. On select,
 * emits `{ id, label }` where `label` is the locale-appropriate
 * human-readable path (DE/EN depending on `locale` prop).
 *
 * Usage:
 *   <GoogleTaxonomyPicker
 *     locale="de"
 *     value={googleCategoryId}
 *     valueLabel={googleCategoryLabel}
 *     onChange={(id, label) => { setGoogleCategoryId(id); setGoogleCategoryLabel(label) }}
 *   />
 */

import { useState, useEffect, useMemo } from 'react'
import { Search, X, CheckCircle2 } from 'lucide-react'

interface TaxonomyRow { id: string; de: string; en: string }
interface TaxonomyFile { version: string; count: number; categories: TaxonomyRow[] }

interface Props {
  locale: string
  value: string | null | undefined
  valueLabel?: string | null | undefined
  onChange: (id: string | null, label: string | null) => void
}

// Module-level cache so remount / multi-mount share the same fetch.
let cachedData: TaxonomyFile | null = null
let cachedPromise: Promise<TaxonomyFile> | null = null

async function loadTaxonomy(): Promise<TaxonomyFile> {
  if (cachedData) return cachedData
  if (!cachedPromise) {
    cachedPromise = fetch('/taxonomy/google-product-categories.json')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<TaxonomyFile>
      })
      .then((data) => {
        cachedData = data
        return data
      })
      .catch((err) => {
        cachedPromise = null // allow retry on next mount
        throw err
      })
  }
  return cachedPromise
}

export function GoogleTaxonomyPicker({ locale, value, valueLabel, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [data, setData] = useState<TaxonomyFile | null>(cachedData)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Lazy-load on first open
  useEffect(() => {
    if (!open || data || loading) return
    setLoading(true)
    setError(null)
    loadTaxonomy()
      .then((d) => setData(d))
      .catch((e) => setError(e?.message ?? 'Ladefehler'))
      .finally(() => setLoading(false))
  }, [open, data, loading])

  const labelKey = locale === 'en' ? 'en' : 'de'

  const results = useMemo(() => {
    if (!data || !query.trim()) return (data?.categories ?? []).slice(0, 50)
    const q = query.toLowerCase()
    const hits: TaxonomyRow[] = []
    for (const row of data.categories) {
      if (row[labelKey].toLowerCase().includes(q) || row.en.toLowerCase().includes(q) || row.id === q) {
        hits.push(row)
        if (hits.length >= 50) break
      }
    }
    return hits
  }, [data, query, labelKey])

  const t3 = (de: string, en: string, ar: string) =>
    locale === 'ar' ? ar : locale === 'en' ? en : de

  return (
    <div className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full h-10 px-3 rounded-xl border bg-background text-sm text-start flex items-center justify-between gap-2 hover:border-[#d4a853] transition-colors"
      >
        <span className="flex items-center gap-2 truncate min-w-0">
          {value ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-[#d4a853] flex-shrink-0" />
              <span className="font-mono text-xs text-muted-foreground flex-shrink-0">{value}</span>
              <span className="truncate">{valueLabel ?? ''}</span>
            </>
          ) : (
            <span className="text-muted-foreground">
              {t3('Google-Taxonomie auswählen…', 'Select Google taxonomy…', 'اختر تصنيف جوجل…')}
            </span>
          )}
        </span>
        {value && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onChange(null, null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onChange(null, null) } }}
            className="h-5 w-5 rounded-full hover:bg-muted flex items-center justify-center flex-shrink-0"
            aria-label={t3('Auswahl löschen', 'Clear', 'مسح')}
          >
            <X className="h-3 w-3" />
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* Panel */}
          <div className="absolute z-50 mt-1 w-full rounded-xl border bg-background shadow-xl max-h-[400px] overflow-hidden flex flex-col">
            <div className="p-2 border-b flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t3(
                  'Suchen (z. B. Hemd, 1604)…',
                  'Search (e.g. shirt, 1604)…',
                  'بحث (مثلاً قميص, 1604)…',
                )}
                className="flex-1 h-8 px-2 bg-transparent text-sm outline-none"
              />
            </div>
            <div className="overflow-y-auto flex-1">
              {loading && (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  {t3('Laden…', 'Loading…', 'جاري التحميل…')}
                </div>
              )}
              {error && (
                <div className="p-4 text-sm text-red-500 text-center">
                  {t3('Fehler beim Laden:', 'Load error:', 'خطأ في التحميل:')} {error}
                </div>
              )}
              {!loading && !error && results.length === 0 && (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  {t3('Keine Treffer', 'No matches', 'لا توجد نتائج')}
                </div>
              )}
              {results.map((row) => (
                <button
                  type="button"
                  key={row.id}
                  onClick={() => {
                    onChange(row.id, row[labelKey])
                    setOpen(false)
                    setQuery('')
                  }}
                  className={`w-full px-3 py-2 text-start flex items-start gap-3 hover:bg-muted/50 transition-colors border-b last:border-b-0 ${row.id === value ? 'bg-[#d4a853]/10' : ''}`}
                >
                  <span className="font-mono text-xs text-muted-foreground mt-0.5 flex-shrink-0 w-14">
                    {row.id}
                  </span>
                  <span className="text-sm leading-snug">{row[labelKey]}</span>
                </button>
              ))}
              {data && results.length === 50 && (
                <div className="p-2 text-xs text-muted-foreground text-center border-t">
                  {t3(
                    'Mehr als 50 Treffer — bitte Suchbegriff präzisieren',
                    'More than 50 matches — refine search',
                    'أكثر من 50 نتيجة — يرجى تحسين البحث',
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
