'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Warehouse, AlertTriangle, Check, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { translateColor } from '@/lib/locale-utils'

const t3 = (l: string, d: string, e: string, a: string) => l === 'ar' ? a : l === 'en' ? e : d

interface Props {
  orderId: string
  currentWarehouseId: string | null
  currentWarehouseName: string | null
  locale: string
}

// Shape of a single stock-warning row coming from the backend. Each entry
// describes one cart line that can't be fulfilled from the target warehouse.
// Backend ships all 3 translations + the snapshot; frontend picks the admin's
// locale with DE → EN → AR → snapshot fallback.
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

// Pick the product name for the admin's current locale. Respects an explicit
// AR translation first when the admin UI is Arabic — falls back through the
// other languages so the warning never shows an empty name.
function pickName(w: StockWarning, locale: string): string {
  if (locale === 'ar') return w.nameAr || w.nameDe || w.nameEn || w.snapshotName || ''
  if (locale === 'en') return w.nameEn || w.nameDe || w.nameAr || w.snapshotName || ''
  return w.nameDe || w.nameEn || w.nameAr || w.snapshotName || ''
}

export function FulfillmentWarehouseSelect({ orderId, currentWarehouseId, locale }: Props) {
  const qc = useQueryClient()
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null)
  const [pendingWarehouseId, setPendingWarehouseId] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<StockWarning[]>([])

  const { data: warehouses } = useQuery({
    queryKey: ['admin-warehouses'],
    queryFn: async () => { const { data } = await api.get('/admin/warehouses'); return data },
    staleTime: 5 * 60 * 1000,
  })

  const changeMut = useMutation({
    mutationFn: async ({ warehouseId, force }: { warehouseId: string; force: boolean }) => {
      const { data } = await api.patch(`/admin/orders/${orderId}/fulfillment`, { warehouseId, force })
      return data
    },
    onSuccess: (data) => {
      if (data.needsConfirmation) {
        // Backend says: stock is low, admin must confirm
        setWarnings(data.warnings ?? [])
        setPendingWarehouseId(pendingWarehouseId) // keep the pending ID
        setToast({
          type: 'warning',
          text: t3(locale,
            `Nicht genug Bestand in "${data.warehouseName}". Trotzdem wechseln?`,
            `Not enough stock in "${data.warehouseName}". Switch anyway?`,
            `لا يوجد مخزون كافٍ في "${data.warehouseName}". هل تريد التبديل؟`)
        })
        return
      }
      qc.invalidateQueries({ queryKey: ['admin-order', orderId] })
      setPendingWarehouseId(null)
      setWarnings([])
      if (data.changed === false) {
        setToast({ type: 'error', text: t3(locale, 'Gleiches Lager', 'Same warehouse', 'نفس المستودع') })
      } else {
        setToast({ type: 'success', text: t3(locale, `Lager gewechselt → ${data.warehouseName}`, `Switched → ${data.warehouseName}`, `تم التبديل → ${data.warehouseName}`) })
      }
      setTimeout(() => setToast(null), 3000)
    },
    onError: (err: any) => {
      setPendingWarehouseId(null)
      setWarnings([])
      // Backend returns the message either as a plain string or as a
      // 3-language object {de, en, ar} (e.g. StockTransferRequired).
      // Pick the admin's locale; fall back to DE then EN.
      const raw = err?.response?.data?.message
      let text: string
      if (typeof raw === 'string') {
        text = raw
      } else if (raw && typeof raw === 'object') {
        text = raw[locale as 'de' | 'en' | 'ar'] ?? raw.de ?? raw.en ?? ''
      } else {
        text = ''
      }
      if (!text) text = t3(locale, 'Fehler beim Lagerwechsel', 'Failed', 'خطأ')
      setToast({ type: 'error', text })
      // Stock-transfer hint is long, give the admin more reading time.
      setTimeout(() => setToast(null), 8000)
    },
  })

  const activeWarehouses = (warehouses ?? []).filter((w: any) => w.isActive)

  if (activeWarehouses.length <= 1) return null

  const handleChange = (warehouseId: string) => {
    if (!warehouseId || warehouseId === currentWarehouseId) return
    setPendingWarehouseId(warehouseId)
    setWarnings([])
    setToast(null)
    changeMut.mutate({ warehouseId, force: false })
  }

  const handleForceConfirm = () => {
    if (!pendingWarehouseId) return
    changeMut.mutate({ warehouseId: pendingWarehouseId, force: true })
  }

  return (
    <div className="mt-3 pt-3 border-t">
      <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
        <Warehouse className="h-3.5 w-3.5" />
        {t3(locale, 'Fulfillment-Lager', 'Fulfillment Warehouse', 'مستودع التنفيذ')}
      </label>
      <select
        value={currentWarehouseId ?? ''}
        onChange={(e) => handleChange(e.target.value)}
        disabled={changeMut.isPending}
        className="w-full h-9 px-3 rounded-xl border bg-background text-sm mt-1"
      >
        {!currentWarehouseId && <option value="">{t3(locale, 'Lager wählen...', 'Select...', 'اختر...')}</option>}
        {activeWarehouses.map((w: any) => (
          <option key={w.id} value={w.id}>
            {w.name} {w.isDefault ? `(${t3(locale, 'Standard', 'Default', 'افتراضي')})` : ''} {w.type === 'STORE' ? '🏪' : '📦'}
          </option>
        ))}
      </select>

      {/* Loading */}
      {changeMut.isPending && (
        <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t3(locale, 'Reservierungen werden verschoben...', 'Moving reservations...', 'جاري نقل الحجوزات...')}
        </div>
      )}

      {/* Warning — needs confirmation. Structured-data layout so each item
          gets its own row with product name + SKU + "available / needed"
          in the admin's locale. Latin values (SKU, numbers) stay dir="ltr"
          inside RTL so they don't get BiDi-sandwiched next to Arabic text. */}
      {toast?.type === 'warning' && pendingWarehouseId && (
        <div className="mt-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-full bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-amber-900 dark:text-amber-200 font-semibold leading-snug">{toast.text}</p>

              {warnings.length > 0 && (
                <div className="mt-3 space-y-2">
                  {warnings.map((w, i) => {
                    const productName = pickName(w, locale)
                    // Color is stored German-canonical — localize.  Size (XS/S/M/L/XL)
                    // is a universal token; keep as-is but force LTR in AR so the
                    // "·" separator doesn't end up on the wrong side.
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
                            <p className="text-xs font-semibold text-amber-900 dark:text-amber-100 truncate">
                              {productName}
                            </p>
                            {variantParts && (
                              <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
                                {variantParts}
                              </p>
                            )}
                            {w.sku && (
                              <p className="text-[10px] text-amber-600 dark:text-amber-500 mt-0.5 font-mono" dir="ltr">
                                {w.sku}
                              </p>
                            )}
                          </div>
                          {/* Two-line labelled pair — avoids the BiDi
                              confusion the inline "0 / 1 متاح / مطلوب"
                              layout had in RTL.  Each number gets its own
                              explicit label right next to it. */}
                          <div className="flex flex-col gap-0.5 text-[11px] flex-shrink-0 whitespace-nowrap text-end">
                            <span className="text-amber-900 dark:text-amber-200 font-semibold">
                              <span className="text-[10px] text-amber-600 dark:text-amber-500 font-normal ltr:mr-1 rtl:ml-1">
                                {t3(locale, 'Verf.', 'Avail.', 'متاح')}
                              </span>
                              <span className="tabular-nums" dir="ltr">{w.available}</span>
                            </span>
                            <span className="text-amber-900 dark:text-amber-200 font-semibold">
                              <span className="text-[10px] text-amber-600 dark:text-amber-500 font-normal ltr:mr-1 rtl:ml-1">
                                {t3(locale, 'Benöt.', 'Req.', 'مطلوب')}
                              </span>
                              <span className="tabular-nums" dir="ltr">{w.needed}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="flex gap-2 mt-4">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs rounded-lg flex-1"
                  onClick={() => { setPendingWarehouseId(null); setToast(null); setWarnings([]) }}
                >
                  {t3(locale, 'Abbrechen', 'Cancel', 'إلغاء')}
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-xs rounded-lg bg-amber-600 hover:bg-amber-700 text-white flex-1"
                  onClick={handleForceConfirm}
                  disabled={changeMut.isPending}
                >
                  {t3(locale, 'Trotzdem wechseln', 'Switch anyway', 'التبديل رغم ذلك')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success / Error */}
      {toast && toast.type !== 'warning' && (
        <div className={`flex items-center gap-1.5 mt-2 text-xs ${toast.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
          {toast.type === 'success' ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          {toast.text}
        </div>
      )}
    </div>
  )
}
