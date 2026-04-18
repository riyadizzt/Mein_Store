'use client'

/**
 * Consolidate-warehouse button — R7.
 *
 * Moves ALL items of an order to a single target warehouse in one atomic
 * transaction. Two-phase flow:
 *   1. User clicks → dropdown opens → user picks target warehouse.
 *   2. First attempt without force. If backend returns `needsConfirmation`
 *      with per-item warnings, we render them in a structured amber box
 *      with a "Trotzdem konsolidieren" button.
 *   3. Second attempt with force=true only fires on explicit user confirm.
 *
 * Shares the same warning-row shape as FulfillmentWarehouseSelect — backend
 * delivers {sku, nameDe/En/Ar, snapshotName, color, size, available, needed}
 * so the warning is fully localized.
 *
 * Complements LineWarehousePicker (per-line move) by giving the admin a
 * "consolidate everything" affordance that produces one ORDER_WAREHOUSE_
 * CONSOLIDATED audit entry instead of N per-item entries.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Layers, AlertTriangle, Loader2, ChevronDown, X } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { translateColor } from '@/lib/locale-utils'

const t3 = (l: string, d: string, e: string, a: string) => (l === 'ar' ? a : l === 'en' ? e : d)

interface Warehouse {
  id: string
  name: string
  type: string
  isActive?: boolean
  isDefault?: boolean
}

interface StockWarning {
  sku: string
  nameDe: string | null
  nameEn: string | null
  nameAr: string | null
  snapshotName: string | null
  color: string | null
  size: string | null
  available: number
  needed: number
}

function pickName(w: StockWarning, locale: string): string {
  if (locale === 'ar') return w.nameAr || w.nameDe || w.nameEn || w.snapshotName || ''
  if (locale === 'en') return w.nameEn || w.nameDe || w.nameAr || w.snapshotName || ''
  return w.nameDe || w.nameEn || w.nameAr || w.snapshotName || ''
}

interface Props {
  orderId: string
  locale: string
}

export function ConsolidateWarehouseButton({ orderId, locale }: Props) {
  const qc = useQueryClient()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingWarehouseId, setPendingWarehouseId] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<StockWarning[]>([])
  const [warehouseName, setWarehouseName] = useState<string>('')
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const { data: warehouses } = useQuery({
    queryKey: ['admin-warehouses'],
    queryFn: async () => {
      const { data } = await api.get('/admin/warehouses')
      return (data ?? []) as Warehouse[]
    },
    staleTime: 5 * 60 * 1000,
  })

  const consolidateMut = useMutation({
    mutationFn: async ({ warehouseId, force }: { warehouseId: string; force: boolean }) => {
      const { data } = await api.post(`/admin/orders/${orderId}/consolidate-warehouse`, {
        warehouseId,
        force,
      })
      return data
    },
    onSuccess: (data) => {
      if (data.needsConfirmation) {
        setWarnings(data.warnings ?? [])
        setWarehouseName(data.warehouseName ?? '')
        // Keep pendingWarehouseId so the confirm button can resend with force
        return
      }
      qc.invalidateQueries({ queryKey: ['admin-order', orderId] })
      setPickerOpen(false)
      setPendingWarehouseId(null)
      setWarnings([])
      if (data.changed === false) {
        setToast({
          type: 'error',
          text: t3(
            locale,
            'Bereits im Ziel-Lager oder keine Items zu verschieben',
            'Already in target or no items to move',
            'بالفعل في المستودع المستهدف أو لا توجد عناصر للنقل',
          ),
        })
      } else {
        setToast({
          type: 'success',
          text: t3(
            locale,
            `${data.itemsMoved} Artikel in "${data.warehouseName}" konsolidiert`,
            `${data.itemsMoved} items consolidated in "${data.warehouseName}"`,
            `تم دمج ${data.itemsMoved} عناصر في "${data.warehouseName}"`,
          ),
        })
      }
      setTimeout(() => setToast(null), 3000)
    },
    onError: (err: any) => {
      setPickerOpen(false)
      setPendingWarehouseId(null)
      setWarnings([])
      const raw = err?.response?.data?.message
      let text: string
      if (typeof raw === 'string') text = raw
      else if (raw && typeof raw === 'object') text = raw[locale as 'de' | 'en' | 'ar'] ?? raw.de ?? raw.en ?? ''
      else text = ''
      if (!text) text = t3(locale, 'Fehler beim Konsolidieren', 'Failed', 'خطأ')
      setToast({ type: 'error', text })
      setTimeout(() => setToast(null), 8000)
    },
  })

  const activeWarehouses = (warehouses ?? []).filter((w) => w.isActive !== false)
  if (activeWarehouses.length <= 1) return null

  const handlePick = (warehouseId: string) => {
    setPendingWarehouseId(warehouseId)
    setWarnings([])
    setPickerOpen(false)
    consolidateMut.mutate({ warehouseId, force: false })
  }

  const handleForce = () => {
    if (!pendingWarehouseId) return
    consolidateMut.mutate({ warehouseId: pendingWarehouseId, force: true })
  }

  const handleCancel = () => {
    setPendingWarehouseId(null)
    setWarnings([])
    setWarehouseName('')
  }

  return (
    <div className="mt-3 pt-3 border-t">
      <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
        <Layers className="h-3.5 w-3.5" />
        {t3(locale, 'Konsolidieren', 'Consolidate', 'دمج')}
      </label>

      {/* Picker button */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          disabled={consolidateMut.isPending}
          className="w-full h-9 px-3 rounded-xl border bg-background text-sm mt-1 flex items-center justify-between gap-2 hover:bg-muted/30 disabled:opacity-50"
        >
          <span className="text-muted-foreground text-xs">
            {t3(
              locale,
              'Alle Artikel in ein Lager verschieben...',
              'Move all items to one warehouse...',
              'نقل جميع العناصر إلى مستودع واحد...',
            )}
          </span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>

        {pickerOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setPickerOpen(false)} />
            <div className="absolute z-40 inset-x-0 top-full mt-1 bg-background border rounded-lg shadow-lg overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {t3(locale, 'Ziel-Lager wählen', 'Pick target', 'اختر المستودع')}
                </span>
                <button
                  type="button"
                  onClick={() => setPickerOpen(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="max-h-64 overflow-auto">
                {activeWarehouses.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => handlePick(w.id)}
                    disabled={consolidateMut.isPending}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-start hover:bg-muted/50 disabled:opacity-50"
                  >
                    <span className="text-sm">{w.type === 'STORE' ? '🏪' : '📦'}</span>
                    <span>{w.name}</span>
                    {w.isDefault && (
                      <span className="text-[10px] text-muted-foreground">
                        ({t3(locale, 'Standard', 'default', 'افتراضي')})
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Loading state */}
      {consolidateMut.isPending && (
        <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t3(locale, 'Konsolidiere...', 'Consolidating...', 'جاري الدمج...')}
        </div>
      )}

      {/* Warnings — needs confirmation.  Same structured-row layout as
          FulfillmentWarehouseSelect, but scoped to the consolidate context. */}
      {warnings.length > 0 && pendingWarehouseId && (
        <div className="mt-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-full bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-amber-900 dark:text-amber-200 font-semibold leading-snug">
                {t3(
                  locale,
                  `Nicht genug Bestand in "${warehouseName}". Trotzdem konsolidieren?`,
                  `Not enough stock in "${warehouseName}". Consolidate anyway?`,
                  `لا يوجد مخزون كافٍ في "${warehouseName}". هل تريد الدمج على أي حال؟`,
                )}
              </p>
              <div className="mt-3 space-y-2">
                {warnings.map((w, i) => {
                  const name = pickName(w, locale)
                  const colorLabel = w.color ? translateColor(w.color, locale) : null
                  const sizeLabel = w.size ?? null
                  const variantParts = [colorLabel, sizeLabel].filter(Boolean).join(' · ')
                  return (
                    <div
                      key={i}
                      className="bg-white/60 dark:bg-black/20 rounded-lg px-3 py-2 border border-amber-100 dark:border-amber-500/10"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-amber-900 dark:text-amber-100 truncate">{name}</p>
                          {variantParts && (
                            <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">{variantParts}</p>
                          )}
                          {w.sku && (
                            <p
                              className="text-[10px] text-amber-600 dark:text-amber-500 mt-0.5 font-mono"
                              dir="ltr"
                            >
                              {w.sku}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-amber-700 dark:text-amber-400">
                              {t3(locale, 'Verf.', 'Avail.', 'متاح')}
                            </span>
                            <span className="text-sm font-bold text-amber-900 dark:text-amber-100 tabular-nums" dir="ltr">
                              {w.available}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-amber-700 dark:text-amber-400">
                              {t3(locale, 'Benöt.', 'Need', 'مطلوب')}
                            </span>
                            <span className="text-sm font-bold text-red-700 dark:text-red-400 tabular-nums" dir="ltr">
                              {w.needed}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="flex gap-2 mt-3">
                <Button
                  variant="default"
                  size="sm"
                  className="h-8 text-xs bg-amber-600 hover:bg-amber-700 text-white"
                  onClick={handleForce}
                  disabled={consolidateMut.isPending}
                >
                  {t3(locale, 'Trotzdem konsolidieren', 'Consolidate anyway', 'ادمج على أي حال')}
                </Button>
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleCancel}>
                  {t3(locale, 'Abbrechen', 'Cancel', 'إلغاء')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success / non-warning error toast */}
      {toast && (
        <div
          className={`mt-2 text-xs rounded-lg px-3 py-2 ${
            toast.type === 'success'
              ? 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300'
              : 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300'
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  )
}
