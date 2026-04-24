'use client'

/**
 * /admin/ebay/category-mapping
 *
 * Admin page: fetches eBay-Taxonomy-API suggestions for every active
 * shop category's DE name, renders Top-3 dropdown per row, batch-saves
 * picks. Auto-approved rows (top-1 normalized match) default to green;
 * needs-review rows amber; fetch-error rows red.
 */

import { useMemo, useState, useEffect } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle2, AlertTriangle, XCircle, Tag, Save } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-modal'

const t3 = (l: string, de: string, en: string, ar: string) =>
  l === 'ar' ? ar : l === 'en' ? en : de

interface Suggestion {
  categoryId: string
  categoryName: string
  breadcrumb: string
}

interface Row {
  categoryId: string
  slug: string
  deName: string
  hasDeTranslation: boolean
  currentEbayCategoryId: string | null
  suggestions: Suggestion[]
  autoApproved: boolean
  suggestedEbayCategoryId: string | null
  fetchError?: string
}

interface AllMatchesResponse {
  treeId: string
  rows: Row[]
  totalCategories: number
  autoApprovedCount: number
  needsReviewCount: number
  fetchErrorCount: number
}

// Per-row UI state: tracks the admin's current pick (dropdown value
// or manual-input string). Starts at the suggestedEbayCategoryId for
// needs-review rows (to make auto-approve actionable with one click).
type RowState = {
  mode: 'dropdown' | 'manual' | 'empty'
  selectedId: string        // suggestion.categoryId or manual numeric
}

export default function EbayCategoryMappingPage() {
  const locale = useLocale()
  const qc = useQueryClient()
  const confirmDialog = useConfirm()

  const { data, isLoading, error } = useQuery<AllMatchesResponse>({
    queryKey: ['admin', 'ebay', 'category-mapping'],
    queryFn: async () => (await api.get('/admin/ebay/category-mapping')).data as AllMatchesResponse,
    staleTime: 0,
    refetchOnWindowFocus: false,
  })

  // rowState[categoryId] = { mode, selectedId }.
  // Initialized when data arrives: suggestion[0] for auto-approved or
  // needs-review rows; current value kept for rows that already had one.
  const [rowState, setRowState] = useState<Record<string, RowState>>({})

  useEffect(() => {
    if (!data) return
    const initial: Record<string, RowState> = {}
    for (const r of data.rows) {
      // Priority: current saved mapping > top-1 suggestion > empty
      if (r.currentEbayCategoryId) {
        // Match against a suggestion, otherwise treat as manual entry
        const matchesSuggestion = r.suggestions.some(
          (s) => s.categoryId === r.currentEbayCategoryId,
        )
        initial[r.categoryId] = matchesSuggestion
          ? { mode: 'dropdown', selectedId: r.currentEbayCategoryId }
          : { mode: 'manual', selectedId: r.currentEbayCategoryId }
      } else if (r.suggestedEbayCategoryId) {
        initial[r.categoryId] = { mode: 'dropdown', selectedId: r.suggestedEbayCategoryId }
      } else {
        initial[r.categoryId] = { mode: 'empty', selectedId: '' }
      }
    }
    setRowState(initial)
  }, [data])

  // Diff between initial state (server value) and current state (admin pick)
  const dirtyChanges = useMemo(() => {
    if (!data) return []
    const changes: Array<{ categoryId: string; ebayCategoryId: string | null }> = []
    for (const r of data.rows) {
      const st = rowState[r.categoryId]
      if (!st) continue
      const picked = st.mode === 'empty' ? null : st.selectedId.trim() || null
      if (picked !== r.currentEbayCategoryId) {
        changes.push({ categoryId: r.categoryId, ebayCategoryId: picked })
      }
    }
    return changes
  }, [data, rowState])

  const saveMut = useMutation({
    mutationFn: async (mappings: Array<{ categoryId: string; ebayCategoryId: string | null }>) =>
      (await api.post('/admin/ebay/category-mapping', { mappings })).data as {
        updated: number
        unchanged: number
      },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['admin', 'ebay', 'category-mapping'] })
      alert(
        t3(
          locale,
          `${result.updated} Kategorien aktualisiert.`,
          `${result.updated} categories updated.`,
          `تم تحديث ${result.updated} من الفئات.`,
        ),
      )
    },
  })

  function handleSave() {
    if (dirtyChanges.length === 0) return
    confirmDialog({
      title: t3(locale, 'Kategorien speichern', 'Save categories', 'حفظ الفئات'),
      description: t3(
        locale,
        `${dirtyChanges.length} Kategorien werden aktualisiert. Fortfahren?`,
        `${dirtyChanges.length} categories will be updated. Continue?`,
        `سيتم تحديث ${dirtyChanges.length} من الفئات. متابعة؟`,
      ),
    }).then((ok) => {
      if (ok) saveMut.mutate(dirtyChanges)
    })
  }

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>
            {t3(
              locale,
              'Lade Kategorien + eBay-Vorschläge…',
              'Loading categories + eBay suggestions…',
              'جارٍ تحميل الفئات والاقتراحات…',
            )}
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {t3(
            locale,
            'Dies dauert ca. 3-5 Sekunden (parallele API-Anfragen).',
            'This takes ~3-5 seconds (batched parallel API calls).',
            'يستغرق هذا من 3 إلى 5 ثوانٍ (استدعاءات موازية).',
          )}
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-2 text-red-600">
          <XCircle className="h-5 w-5" />
          <span>
            {t3(locale, 'Fehler beim Laden', 'Loading failed', 'فشل التحميل')}:{' '}
            {(error as any)?.message ?? String(error)}
          </span>
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="p-6 space-y-4 max-w-[1400px]">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Tag className="h-5 w-5 text-[#d4a853]" />
            {t3(locale, 'eBay-Kategorien-Mapping', 'eBay Category Mapping', 'ربط فئات eBay')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t3(
              locale,
              'Kategorie-IDs für eBay.de — Suchbasis: Deutsch.',
              'Category mappings for eBay.de — matched against German names.',
              'تعيين الفئات لـ eBay.de — المطابقة على الأسماء الألمانية.',
            )}
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={dirtyChanges.length === 0 || saveMut.isPending}
          className="gap-2"
        >
          {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t3(
            locale,
            `Alle speichern (${dirtyChanges.length})`,
            `Save all (${dirtyChanges.length})`,
            `حفظ الكل (${dirtyChanges.length})`,
          )}
        </Button>
      </header>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-3 text-xs">
        <SummaryChip label={t3(locale, 'Gesamt', 'Total', 'الإجمالي')} value={data.totalCategories} color="slate" />
        <SummaryChip label={t3(locale, 'Auto-approved', 'Auto', 'مقبول تلقائياً')} value={data.autoApprovedCount} color="emerald" />
        <SummaryChip label={t3(locale, 'Überprüfen', 'Review', 'مراجعة')} value={data.needsReviewCount} color="amber" />
        {data.fetchErrorCount > 0 && (
          <SummaryChip label={t3(locale, 'Fehler', 'Errors', 'أخطاء')} value={data.fetchErrorCount} color="red" />
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase">
            <tr>
              <th className="text-start p-3 w-24">
                {t3(locale, 'Status', 'Status', 'الحالة')}
              </th>
              <th className="text-start p-3 w-32">Slug</th>
              <th className="text-start p-3">
                {t3(locale, 'DE-Name', 'DE name', 'الاسم الألماني')}
              </th>
              <th className="text-start p-3 w-32">
                {t3(locale, 'Aktuelle ID', 'Current ID', 'المعرّف الحالي')}
              </th>
              <th className="text-start p-3">
                {t3(locale, 'eBay-Vorschläge / Zuordnung', 'eBay suggestions / mapping', 'اقتراحات eBay / التعيين')}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <TableRow
                key={r.categoryId}
                row={r}
                state={rowState[r.categoryId]}
                onChange={(next) => setRowState((s) => ({ ...s, [r.categoryId]: next }))}
                locale={locale}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SummaryChip({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: 'slate' | 'emerald' | 'amber' | 'red'
}) {
  const cls = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300',
    emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
    red: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  }[color]
  return (
    <span className={`px-3 py-1.5 rounded-full font-medium ${cls}`}>
      {label}: <span className="tabular-nums font-semibold">{value}</span>
    </span>
  )
}

function TableRow({
  row,
  state,
  onChange,
  locale,
}: {
  row: Row
  state: RowState | undefined
  onChange: (next: RowState) => void
  locale: string
}) {
  if (!state) return null

  const bgColor = row.fetchError
    ? 'bg-red-50/30 dark:bg-red-900/10'
    : row.autoApproved
    ? 'bg-emerald-50/30 dark:bg-emerald-900/10'
    : 'bg-amber-50/30 dark:bg-amber-900/10'

  return (
    <tr className={`border-t ${bgColor}`}>
      <td className="p-3">
        {row.fetchError ? (
          <Badge color="red" icon={<XCircle className="h-3 w-3" />}>
            {t3(locale, 'Fehler', 'Error', 'خطأ')}
          </Badge>
        ) : row.autoApproved ? (
          <Badge color="emerald" icon={<CheckCircle2 className="h-3 w-3" />}>
            {t3(locale, 'Auto', 'Auto', 'تلقائي')}
          </Badge>
        ) : (
          <Badge color="amber" icon={<AlertTriangle className="h-3 w-3" />}>
            {t3(locale, 'Überprüfen', 'Review', 'مراجعة')}
          </Badge>
        )}
      </td>
      <td className="p-3 font-mono text-xs text-muted-foreground">{row.slug}</td>
      <td className="p-3">
        <div>{row.deName}</div>
        {!row.hasDeTranslation && (
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {t3(
              locale,
              '(Slug verwendet — keine DE-Übersetzung)',
              '(slug used — no DE translation)',
              '(تم استخدام الـ slug — لا توجد ترجمة ألمانية)',
            )}
          </div>
        )}
      </td>
      <td className="p-3 font-mono text-xs">
        {row.currentEbayCategoryId ?? <span className="text-muted-foreground">—</span>}
      </td>
      <td className="p-3 space-y-2">
        {row.fetchError ? (
          <>
            <div className="text-xs text-red-700 dark:text-red-300">{row.fetchError}</div>
            <input
              type="text"
              inputMode="numeric"
              pattern="^[0-9]+$"
              placeholder={t3(locale, 'Manuelle eBay-ID', 'Manual eBay ID', 'معرّف eBay يدوي')}
              value={state.mode === 'manual' ? state.selectedId : ''}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9]/g, '')
                onChange({ mode: v ? 'manual' : 'empty', selectedId: v })
              }}
              className="w-full h-9 px-3 rounded-lg border bg-background text-sm"
            />
          </>
        ) : (
          <>
            {row.suggestions.length === 0 && (
              <div className="text-xs text-muted-foreground">
                {t3(locale, 'Keine Vorschläge gefunden', 'No suggestions found', 'لم يتم العثور على اقتراحات')}
              </div>
            )}
            {row.suggestions.length > 0 && (
              <select
                value={state.mode === 'dropdown' ? state.selectedId : state.mode === 'manual' ? '__manual__' : '__empty__'}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === '__manual__') onChange({ mode: 'manual', selectedId: '' })
                  else if (v === '__empty__') onChange({ mode: 'empty', selectedId: '' })
                  else onChange({ mode: 'dropdown', selectedId: v })
                }}
                className="w-full h-9 px-3 rounded-lg border bg-background text-sm"
              >
                {row.suggestions.map((s, i) => (
                  <option key={s.categoryId} value={s.categoryId}>
                    {i === 0 ? '⭐ ' : ''}
                    {s.breadcrumb} ({s.categoryId})
                  </option>
                ))}
                <option value="__manual__">
                  — {t3(locale, 'Manuell eingeben', 'Enter manually', 'إدخال يدوي')} —
                </option>
                <option value="__empty__">
                  — {t3(locale, 'Leer lassen', 'Leave empty', 'اتركه فارغًا')} —
                </option>
              </select>
            )}
            {state.mode === 'manual' && (
              <input
                type="text"
                inputMode="numeric"
                pattern="^[0-9]+$"
                placeholder={t3(locale, 'Numerische eBay-ID', 'Numeric eBay ID', 'معرّف eBay رقمي')}
                value={state.selectedId}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9]/g, '')
                  onChange({ mode: 'manual', selectedId: v })
                }}
                className="w-full h-9 px-3 rounded-lg border bg-background text-sm"
              />
            )}
          </>
        )}
      </td>
    </tr>
  )
}

function Badge({
  color,
  icon,
  children,
}: {
  color: 'emerald' | 'amber' | 'red'
  icon: React.ReactNode
  children: React.ReactNode
}) {
  const cls = {
    emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
    red: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  }[color]
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium ${cls}`}>
      {icon}
      {children}
    </span>
  )
}
