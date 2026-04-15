'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ClipboardList, ArrowLeft, CheckCircle, Clock, XCircle, Package,
  Warehouse, Store, Trash2, AlertTriangle, PlayCircle, RotateCcw,
} from 'lucide-react'
import { api } from '@/lib/api'
import { getProductName, formatDateTime } from '@/lib/locale-utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

const STATUS_ICONS: Record<string, any> = { in_progress: Clock, completed: CheckCircle, cancelled: XCircle }
const STATUS_COLORS: Record<string, string> = {
  in_progress: 'text-blue-600 bg-blue-100 dark:bg-blue-500/20 dark:text-blue-300',
  completed: 'text-green-600 bg-green-100 dark:bg-green-500/20 dark:text-green-300',
  cancelled: 'text-gray-600 bg-gray-100 dark:bg-gray-500/20 dark:text-gray-300',
}

// Parse notes field `correction_of:<sourceId>` to detect correction
// stocktakes. We store it as a plain string in the DB to avoid needing
// a schema migration — the frontend is the only consumer.
const parseCorrectionSource = (notes: string | null | undefined): string | null => {
  if (!notes) return null
  const match = notes.match(/^correction_of:(.+)$/)
  return match ? match[1] : null
}

export default function StocktakePage() {
  const locale = useLocale()
  const t = useTranslations('admin')
  const router = useRouter()
  const qc = useQueryClient()

  const [selectedStocktake, setSelectedStocktake] = useState<string | null>(null)
  const [showStartModal, setShowStartModal] = useState(false)
  const [startWarehouseId, setStartWarehouseId] = useState('')
  const [startCategoryId, setStartCategoryId] = useState('')
  const [startError, setStartError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; shortId: string } | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [correctionError, setCorrectionError] = useState<string | null>(null)
  // Warehouse filter tab. null = show all. Otherwise a warehouseId.
  const [warehouseFilter, setWarehouseFilter] = useState<string | null>(null)

  // Typed-confirmation phrase for delete (intentionally the word "löschen"
  // in each locale — not the stocktake id — so admin has to think).
  const deletePhrase = locale === 'ar' ? 'حذف' : locale === 'en' ? 'delete' : 'löschen'

  const { data: stocktakes } = useQuery({
    queryKey: ['stocktakes'],
    queryFn: async () => { const { data } = await api.get('/admin/stocktakes'); return data },
  })

  const { data: departments } = useQuery({
    queryKey: ['inventory-departments'],
    queryFn: async () => { const { data } = await api.get('/admin/inventory/summary'); return data },
  })

  const { data: warehouses } = useQuery({
    queryKey: ['admin-warehouses'],
    queryFn: async () => { const { data } = await api.get('/admin/warehouses'); return data },
  })

  const { data: detail } = useQuery({
    queryKey: ['stocktake-detail', selectedStocktake],
    queryFn: async () => { const { data } = await api.get(`/admin/stocktakes/${selectedStocktake}`); return data },
    enabled: !!selectedStocktake,
  })

  const startMut = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/admin/stocktakes', {
        warehouseId: startWarehouseId,
        categoryId: startCategoryId || null,
      })
      return data
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['stocktakes'] })
      setShowStartModal(false)
      setStartWarehouseId('')
      setStartCategoryId('')
      setStartError(null)
      setSelectedStocktake(data.id)
    },
    onError: (err: any) => {
      // Backend returns structured {error, message:{de,en,ar}} for both
      // WarehouseRequired and StocktakeAlreadyInProgress.
      const data = err?.response?.data
      const msg = data?.message?.[locale] ?? data?.message?.de
      setStartError(msg ?? (locale === 'ar' ? 'فشل بدء الجرد' : locale === 'en' ? 'Failed to start stocktake' : 'Inventur konnte nicht gestartet werden'))
    },
  })

  const updateItemMut = useMutation({
    mutationFn: async ({ itemId, actualQty }: { itemId: string; actualQty: number }) => {
      await api.patch(`/admin/stocktakes/items/${itemId}`, { actualQty })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['stocktake-detail', selectedStocktake] }) },
  })

  const completeMut = useMutation({
    mutationFn: async (applyChanges: boolean) => { await api.post(`/admin/stocktakes/${selectedStocktake}/complete`, { applyChanges }) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['stocktakes'] }); qc.invalidateQueries({ queryKey: ['admin-inventory'] }); setSelectedStocktake(null) },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/stocktakes/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stocktakes'] })
      setDeleteTarget(null)
      setDeleteConfirmText('')
      // Also close detail view if we deleted the currently-open one.
      if (selectedStocktake === deleteTarget?.id) setSelectedStocktake(null)
    },
  })

  const correctionMut = useMutation({
    mutationFn: async (sourceId: string) => {
      const { data } = await api.post(`/admin/stocktakes/${sourceId}/correction`)
      return data
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['stocktakes'] })
      setCorrectionError(null)
      setSelectedStocktake(data.id)
    },
    onError: (err: any) => {
      const data = err?.response?.data
      const msg = data?.message?.[locale] ?? data?.message?.de
      setCorrectionError(msg ?? (locale === 'ar' ? 'فشل إنشاء الجرد التصحيحي' : locale === 'en' ? 'Failed to create correction stocktake' : 'Korrektur konnte nicht gestartet werden'))
    },
  })

  const getName = (ts: any[]) => getProductName(ts, locale)
  const fmtDate = (d: string) => formatDateTime(d, locale)

  // 3-way translator helper.
  const L = (de: string, en: string, ar: string) => locale === 'ar' ? ar : locale === 'en' ? en : de

  // Warehouse icon/label helpers. STORE → storefront icon, else warehouse.
  const whIcon = (type: string) => type === 'STORE' ? Store : Warehouse
  const whTypeLabel = (type: string) => type === 'STORE'
    ? L('Laden', 'Store', 'متجر')
    : L('Lager', 'Warehouse', 'مستودع')

  // Detail view
  if (selectedStocktake && detail) {
    const items = detail.items ?? []
    const counted = items.filter((i: any) => i.actualQty != null).length
    const diffs = items.filter((i: any) => i.difference && i.difference !== 0)
    const correctionSourceId = parseCorrectionSource(detail.notes)
    const wh = detail.warehouse ?? (warehouses as any[])?.find((w: any) => w.id === detail.warehouseId)
    const WhIcon = whIcon(wh?.type ?? 'WAREHOUSE')

    return (
      <div>
        <AdminBreadcrumb items={[{ label: t('inventory.title'), href: `/${locale}/admin/inventory` }, { label: t('inventory.stocktakeTitle'), href: `/${locale}/admin/inventory/stocktake` }, { label: `#${selectedStocktake.slice(-6)}` }]} />
        <button onClick={() => setSelectedStocktake(null)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 group">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180 group-hover:ltr:-translate-x-1 group-hover:rtl:translate-x-1 transition-transform" />{t('inventory.backToOverview')}
        </button>

        {/* Correction banner — visible when this stocktake is a correction */}
        {correctionSourceId && (
          <div className="mb-4 flex items-start gap-3 px-4 py-3 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10">
            <RotateCcw className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                {L('Korrektur-Inventur', 'Correction Stocktake', 'جرد تصحيحي')}
              </div>
              <div className="text-xs text-amber-800/80 dark:text-amber-300/70">
                {L(
                  `Basiert auf den Ist-Werten von #${correctionSourceId.slice(-6)}. Nur die Zeilen korrigieren, die falsch gezählt wurden.`,
                  `Based on the actuals of #${correctionSourceId.slice(-6)}. Only edit rows that were mis-counted.`,
                  `يستند إلى القيم الفعلية من #${correctionSourceId.slice(-6)}. عدّل فقط الأسطر التي حُسبت بشكل خاطئ.`,
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-bold">{t('inventory.stocktakeTitle')} #{selectedStocktake.slice(-6)}</h1>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {wh && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-xs font-medium">
                  <WhIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  {/* Latin warehouse name isolated from Arabic runs */}
                  <span dir="ltr" className="leading-none">{wh.name}</span>
                  <span className="text-muted-foreground/60">·</span>
                  <span className="text-muted-foreground">{whTypeLabel(wh.type)}</span>
                </span>
              )}
              <span className="text-sm text-muted-foreground">{counted}/{items.length} {t('inventory.variant')} · {diffs.length} {t('inventory.stocktakeDiff')}</span>
            </div>
          </div>
          {detail.status === 'in_progress' && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="rounded-xl text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-500/10"
                onClick={() => setDeleteTarget({ id: detail.id, shortId: detail.id.slice(-6) })}
              >
                <Trash2 className="h-4 w-4 me-1.5" />
                {L('Verwerfen', 'Discard', 'تجاهل')}
              </Button>
              <Button variant="outline" className="rounded-xl" onClick={() => completeMut.mutate(false)}>{t('inventory.stocktakeComplete')}</Button>
              <Button className="rounded-xl bg-green-600 hover:bg-green-700" onClick={() => completeMut.mutate(true)} disabled={completeMut.isPending}>{t('inventory.stocktakeApply')}</Button>
            </div>
          )}
          {detail.status === 'completed' && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="rounded-xl border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-400 dark:hover:bg-amber-500/10"
                onClick={() => correctionMut.mutate(detail.id)}
                disabled={correctionMut.isPending}
              >
                <RotateCcw className="h-4 w-4 me-1.5" />
                {correctionMut.isPending
                  ? '...'
                  : L('Korrektur-Inventur starten', 'Start correction stocktake', 'بدء جرد تصحيحي')}
              </Button>
            </div>
          )}
        </div>

        {correctionError && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-sm text-red-800 dark:text-red-300">
            {correctionError}
          </div>
        )}

        <div className="bg-background border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/30">
                <th className="text-start px-4 py-3 font-semibold text-sm uppercase text-muted-foreground">{t('inventory.product')}</th>
                <th className="text-start px-4 py-3 font-semibold text-sm uppercase text-muted-foreground">SKU</th>
                <th className="text-start px-4 py-3 font-semibold text-sm uppercase text-muted-foreground">{t('inventory.variant')}</th>
                <th className="text-center px-4 py-3 font-semibold text-sm uppercase text-muted-foreground">{t('inventory.stocktakeExpected')}</th>
                <th className="text-center px-4 py-3 font-semibold text-sm uppercase text-muted-foreground">{t('inventory.stocktakeActual')}</th>
                <th className="text-center px-4 py-3 font-semibold text-sm uppercase text-muted-foreground">{t('inventory.stocktakeDiff')}</th>
              </tr></thead>
              <tbody>
                {items.map((item: any) => {
                  const v = item.variant
                  const hasDiff = item.difference && item.difference !== 0
                  return (
                    <tr key={item.id} className={`border-b transition-colors ${hasDiff ? (item.difference > 0 ? 'bg-green-50/50 dark:bg-green-500/5' : 'bg-red-50/50 dark:bg-red-500/5') : 'hover:bg-muted/20'}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {v?.product?.images?.[0]?.url ? <img src={v.product.images[0].url} alt="" className="h-8 w-8 rounded object-cover" />
                            : <div className="h-8 w-8 rounded bg-muted flex items-center justify-center"><Package className="h-3.5 w-3.5 text-muted-foreground/30" /></div>}
                          <span className="text-[13px] font-medium line-clamp-1">{v ? getName(v.product?.translations ?? []) : '—'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{v?.sku ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{v?.color}/{v?.size}</td>
                      <td className="px-4 py-3 text-center font-medium">{item.expectedQty}</td>
                      <td className="px-4 py-3 text-center">
                        {detail.status === 'in_progress' ? (
                          <Input type="number" defaultValue={item.actualQty ?? ''} className="w-20 h-8 text-center rounded-lg mx-auto text-sm"
                            onBlur={(e) => { const v = +e.target.value; if (!isNaN(v) && v >= 0) updateItemMut.mutate({ itemId: item.id, actualQty: v }) }} />
                        ) : (
                          <span className="font-medium">{item.actualQty ?? '—'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {item.difference != null ? (
                          <span className={`font-bold ${item.difference > 0 ? 'text-green-600' : item.difference < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                            {item.difference > 0 ? '+' : ''}{item.difference}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Delete confirmation modal — re-used for detail-view discard */}
        {deleteTarget && <DeleteModal
          target={deleteTarget}
          confirmText={deleteConfirmText}
          setConfirmText={setDeleteConfirmText}
          phrase={deletePhrase}
          pending={deleteMut.isPending}
          onCancel={() => { setDeleteTarget(null); setDeleteConfirmText('') }}
          onConfirm={() => deleteMut.mutate(deleteTarget.id)}
          locale={locale}
          L={L}
        />}
      </div>
    )
  }

  // List view
  return (
    <div>
      <AdminBreadcrumb items={[{ label: t('inventory.title'), href: `/${locale}/admin/inventory` }, { label: t('inventory.stocktakeTitle') }]} />
      <button onClick={() => router.push(`/${locale}/admin/inventory`)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 group">
        <ArrowLeft className="h-4 w-4 rtl:rotate-180 group-hover:ltr:-translate-x-1 group-hover:rtl:translate-x-1 transition-transform" />{t('inventory.backToOverview')}
      </button>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('inventory.stocktakeTitle')}</h1>
        <Button className="rounded-xl gap-2" onClick={() => { setShowStartModal(true); setStartError(null) }}>
          <ClipboardList className="h-4 w-4" />{t('inventory.stocktakeStart')}
        </Button>
      </div>

      {/* Warehouse filter tabs — one chip per warehouse that actually
          has stocktakes + an "Alle" chip. Derived from the live list so
          admins don't see empty tabs. Counts include all statuses (in
          progress, completed, cancelled) because the visual status is
          handled per-row below. */}
      {(() => {
        const all = (stocktakes as any[]) ?? []
        if (all.length === 0) return null
        // Bucket by warehouseId → {wh, count}
        const map = new Map<string, { wh: any; count: number }>()
        for (const st of all) {
          const wh = st.warehouse
          if (!wh) continue
          const existing = map.get(wh.id)
          if (existing) existing.count++
          else map.set(wh.id, { wh, count: 1 })
        }
        const buckets = Array.from(map.values()).sort((a, b) => {
          // STORE first, then warehouse, then by name. Keeps the store
          // (the one admins touch daily) on the left in LTR / right in RTL.
          if (a.wh.type !== b.wh.type) return a.wh.type === 'STORE' ? -1 : 1
          return a.wh.name.localeCompare(b.wh.name)
        })

        // Single-warehouse case: no point showing a tab bar with one tab.
        if (buckets.length <= 1) return null

        return (
          <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-2 -mx-1 px-1">
            {/* "Alle" tab — always first */}
            <button
              onClick={() => setWarehouseFilter(null)}
              className={`inline-flex items-center gap-2 px-4 h-10 rounded-full border flex-shrink-0 transition-all ${
                warehouseFilter === null
                  ? 'bg-foreground text-background border-foreground shadow-sm'
                  : 'bg-background text-foreground border-border hover:border-foreground/40 hover:bg-muted/50'
              }`}
            >
              <span className="text-sm font-semibold">
                {L('Alle Standorte', 'All locations', 'جميع المواقع')}
              </span>
              <span className={`text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded-full ${
                warehouseFilter === null ? 'bg-background/20 text-background' : 'bg-muted text-muted-foreground'
              }`}>{all.length}</span>
            </button>

            {/* One tab per warehouse that has data */}
            {buckets.map(({ wh, count }) => {
              const WhIcon = whIcon(wh.type)
              const active = warehouseFilter === wh.id
              return (
                <button
                  key={wh.id}
                  onClick={() => setWarehouseFilter(wh.id)}
                  className={`inline-flex items-center gap-2 px-4 h-10 rounded-full border flex-shrink-0 transition-all ${
                    active
                      ? 'bg-foreground text-background border-foreground shadow-sm'
                      : 'bg-background text-foreground border-border hover:border-foreground/40 hover:bg-muted/50'
                  }`}
                >
                  <WhIcon className={`h-4 w-4 flex-shrink-0 ${active ? 'text-background' : 'text-muted-foreground'}`} />
                  <span dir="ltr" className="text-sm font-semibold leading-none">{wh.name}</span>
                  <span className={`text-[10px] font-medium uppercase tracking-wide ${active ? 'text-background/70' : 'text-muted-foreground/70'}`}>
                    {whTypeLabel(wh.type)}
                  </span>
                  <span className={`text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded-full ${
                    active ? 'bg-background/20 text-background' : 'bg-muted text-muted-foreground'
                  }`}>{count}</span>
                </button>
              )
            })}
          </div>
        )
      })()}

      <div className="bg-background border rounded-2xl overflow-hidden">
        {(() => {
          const all = (stocktakes as any[]) ?? []
          const filtered = warehouseFilter
            ? all.filter((st) => st.warehouse?.id === warehouseFilter)
            : all
          if (all.length === 0) {
            return (
              <div className="py-16 text-center">
                <ClipboardList className="h-12 w-12 mx-auto mb-3 text-muted-foreground/20" />
                <p className="text-muted-foreground">{t('inventory.stocktakeNoItems')}</p>
              </div>
            )
          }
          if (filtered.length === 0) {
            return (
              <div className="py-16 text-center">
                <ClipboardList className="h-12 w-12 mx-auto mb-3 text-muted-foreground/20" />
                <p className="text-muted-foreground mb-3">
                  {L(
                    'Keine Inventuren für diesen Standort',
                    'No stocktakes for this location',
                    'لا توجد عمليات جرد لهذا الموقع',
                  )}
                </p>
                <button
                  onClick={() => setWarehouseFilter(null)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  {L('Alle Standorte anzeigen', 'Show all locations', 'عرض جميع المواقع')}
                </button>
              </div>
            )
          }
          return (
          <div className="divide-y">{filtered.map((st: any) => {
            const Icon = STATUS_ICONS[st.status] ?? Clock
            const wh = st.warehouse
            const WhIcon = whIcon(wh?.type ?? 'WAREHOUSE')
            const isCorrection = !!parseCorrectionSource(st.notes)
            const isInProgress = st.status === 'in_progress'

            return (
              <div key={st.id} className="group relative flex items-center gap-4 px-6 py-4 hover:bg-muted/20 transition-colors">
                <button onClick={() => setSelectedStocktake(st.id)} className="flex flex-1 items-center gap-4 text-start min-w-0">
                  <div className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 ${STATUS_COLORS[st.status] ?? 'bg-muted'}`}><Icon className="h-5 w-5" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">#{st.id.slice(-6)}</span>
                      {isCorrection && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                          <RotateCcw className="h-3 w-3" />
                          {L('Korrektur', 'Correction', 'تصحيح')}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-muted-foreground">
                      {wh && (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted text-foreground font-medium">
                          <WhIcon className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          {/* Name is Latin even in AR — isolate it so BiDi
                              doesn't shuffle it with surrounding Arabic */}
                          <span dir="ltr" className="leading-none">{wh.name}</span>
                          <span className="text-muted-foreground/60 text-[10px]">
                            · {whTypeLabel(wh.type)}
                          </span>
                        </span>
                      )}
                      {/* Date contains Latin digits + "م" marker → wrap
                          in LTR so "2026/04/15 02:46 م" stays logical */}
                      <span dir="ltr" className="tabular-nums">{fmtDate(st.createdAt)}</span>
                      <span>·</span>
                      <span>{st._count?.items ?? 0} {t('inventory.variant')}</span>
                    </div>
                  </div>
                </button>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {isInProgress && (
                    <span className="inline-flex items-center gap-1 text-xs text-blue-700 dark:text-blue-300 font-medium">
                      <PlayCircle className="h-3.5 w-3.5" />
                      {L('Fortsetzen', 'Resume', 'متابعة')}
                    </span>
                  )}
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[st.status]}`}>
                    {t(`inventory.stocktake${st.status === 'in_progress' ? 'InProgress' : st.status === 'completed' ? 'Completed' : 'Cancelled'}`)}
                  </span>
                  {isInProgress && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: st.id, shortId: st.id.slice(-6) }) }}
                      className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-500/20 transition-all"
                      title={L('Verwerfen', 'Discard', 'تجاهل')}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}</div>
          )
        })()}
      </div>

      {/* Start Modal */}
      {showStartModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowStartModal(false)} />
          <div className="relative bg-background rounded-2xl p-6 w-full max-w-md shadow-2xl" style={{ animation: 'fadeSlideUp 300ms ease-out' }}>
            <h3 className="text-lg font-bold mb-4">{t('inventory.stocktakeStart')}</h3>
            <div className="space-y-4">
              {/* Warehouse — REQUIRED. This is the fix that stops the silent
                  "default warehouse" trap that hid the picker previously. */}
              <div>
                <label className="text-xs font-semibold mb-1.5 block">
                  {L('Lager / Laden', 'Warehouse / Store', 'المستودع / المتجر')}
                  <span className="text-red-500 ms-1">*</span>
                </label>
                <select
                  value={startWarehouseId}
                  onChange={(e) => setStartWarehouseId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border bg-background text-sm"
                  required
                >
                  <option value="">
                    {L('— Bitte wählen —', '— Please choose —', '— يرجى الاختيار —')}
                  </option>
                  {(warehouses as any[] ?? []).filter((w: any) => w.isActive !== false).map((w: any) => (
                    <option key={w.id} value={w.id}>
                      {w.type === 'STORE' ? '🏪 ' : '📦 '}{w.name} — {whTypeLabel(w.type)}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  {L(
                    'Eine Inventur = ein Standort. Physisch vor Ort zählen.',
                    'One stocktake = one location. Count physically on-site.',
                    'جرد واحد = موقع واحد. يجب العد ماديًا في الموقع.',
                  )}
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold mb-1.5 block">
                  {t('inventory.stocktakeSelectCategory')}
                  <span className="text-muted-foreground ms-1 font-normal">
                    ({L('optional', 'optional', 'اختياري')})
                  </span>
                </label>
                <select value={startCategoryId} onChange={(e) => setStartCategoryId(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border bg-background text-sm">
                  <option value="">{t('inventory.allItems')}</option>
                  {(departments as any[] ?? []).map((d: any) => <option key={d.id} value={d.id}>{getName(d.translations)}</option>)}
                </select>
              </div>

              {startError && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-xs text-red-800 dark:text-red-300">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>{startError}</span>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1 rounded-xl" onClick={() => { setShowStartModal(false); setStartError(null) }}>
                  {t('inventory.cancel')}
                </Button>
                <Button
                  className="flex-1 rounded-xl"
                  disabled={!startWarehouseId || startMut.isPending}
                  onClick={() => startMut.mutate()}
                >
                  {startMut.isPending ? '...' : t('inventory.stocktakeStart')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Modal — used from both list and detail view */}
      {deleteTarget && <DeleteModal
        target={deleteTarget}
        confirmText={deleteConfirmText}
        setConfirmText={setDeleteConfirmText}
        phrase={deletePhrase}
        pending={deleteMut.isPending}
        onCancel={() => { setDeleteTarget(null); setDeleteConfirmText('') }}
        onConfirm={() => deleteMut.mutate(deleteTarget.id)}
        locale={locale}
        L={L}
      />}

      <style>{`@keyframes fadeSlideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  )
}

// Shared confirmation modal. The admin must type the phrase
// "löschen" / "delete" / "حذف" before the button enables. Same pattern
// as the hard-delete modal on the products page.
function DeleteModal({
  target, confirmText, setConfirmText, phrase, pending, onCancel, onConfirm, locale, L,
}: {
  target: { id: string; shortId: string }
  confirmText: string
  setConfirmText: (v: string) => void
  phrase: string
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
  locale: string
  L: (de: string, en: string, ar: string) => string
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="bg-background border-2 border-red-500/40 rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-red-100 dark:bg-red-500/20 flex items-center justify-center flex-shrink-0">
            <Trash2 className="h-6 w-6 text-red-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-red-600">
              {L('Inventur verwerfen', 'Discard stocktake', 'تجاهل الجرد')}
            </h2>
            <p className="text-[11px] text-muted-foreground">#{target.shortId}</p>
          </div>
        </div>

        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg p-3 text-xs text-red-900 dark:text-red-200">
          {L(
            'Alle gezählten Mengen dieser Inventur gehen verloren. Die Lagerbestände werden NICHT geändert — nur dieser Zähl-Vorgang wird gelöscht.',
            'All counted quantities in this stocktake will be lost. Inventory quantities are NOT affected — only this count session is deleted.',
            'ستفقد جميع الكميات التي تم عدّها. لن تتأثر كميات المخزون — يتم حذف جلسة العد فقط.',
          )}
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            {locale === 'ar'
              ? <>اكتب <code className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono">{phrase}</code> للتأكيد:</>
              : locale === 'en'
              ? <>Type <code className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono">{phrase}</code> to confirm:</>
              : <>Tippe <code className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono">{phrase}</code> zur Bestätigung:</>}
          </label>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={phrase}
            className="w-full h-11 px-3 rounded-lg border border-red-300 dark:border-red-500/40 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
            autoFocus
            dir={locale === 'ar' ? 'rtl' : 'ltr'}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onCancel}>
            {locale === 'ar' ? 'إلغاء' : locale === 'en' ? 'Cancel' : 'Abbrechen'}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={confirmText.trim() !== phrase || pending}
            className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-40"
          >
            {pending ? '...' : L('Verwerfen', 'Discard', 'تجاهل')}
          </Button>
        </div>
      </div>
    </div>
  )
}
