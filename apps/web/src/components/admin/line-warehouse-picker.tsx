'use client'

/**
 * Per-line warehouse picker for an order-item row.
 *
 * Shows a compact badge with the line's current fulfillment warehouse. Click
 * opens a dropdown to move ONLY this item to a different warehouse — matches
 * the R5 backend endpoint PATCH /admin/orders/:id/items/:itemId/warehouse.
 *
 * For orders in non-editable states (shipped / delivered / cancelled /
 * refunded) the component renders a read-only badge (no dropdown).
 *
 * Error handling mirrors FulfillmentWarehouseSelect: structured 3-language
 * errors (StockTransferRequired, OrderNotEditable, NoActiveReservation) are
 * shown as toast with the admin's locale. CHECK-constraint violations fall
 * through to a clear "transfer stock first" hint.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Warehouse as WarehouseIcon, Check, Loader2, X, ChevronDown } from 'lucide-react'
import { api } from '@/lib/api'

const t3 = (l: string, d: string, e: string, a: string) => (l === 'ar' ? a : l === 'en' ? e : d)

interface Warehouse {
  id: string
  name: string
  type: string
  isActive?: boolean
  isDefault?: boolean
}

interface Props {
  orderId: string
  itemId: string
  currentWarehouse: { id: string; name: string; type: string } | null
  editable: boolean
  locale: string
}

export function LineWarehousePicker({ orderId, itemId, currentWarehouse, editable, locale }: Props) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const { data: warehouses } = useQuery({
    queryKey: ['admin-warehouses'],
    queryFn: async () => {
      const { data } = await api.get('/admin/warehouses')
      return (data ?? []) as Warehouse[]
    },
    staleTime: 5 * 60 * 1000,
    enabled: editable,
  })

  const changeMut = useMutation({
    mutationFn: async (warehouseId: string) => {
      const { data } = await api.patch(`/admin/orders/${orderId}/items/${itemId}/warehouse`, {
        warehouseId,
      })
      return data
    },
    onSuccess: (data) => {
      setOpen(false)
      qc.invalidateQueries({ queryKey: ['admin-order', orderId] })
      if (data.changed === false) {
        setToast({
          type: 'error',
          text: t3(locale, 'Gleiches Lager', 'Same warehouse', 'نفس المستودع'),
        })
      } else {
        setToast({
          type: 'success',
          text: t3(
            locale,
            `→ ${data.warehouseName}`,
            `→ ${data.warehouseName}`,
            `→ ${data.warehouseName}`,
          ),
        })
      }
      setTimeout(() => setToast(null), 2500)
    },
    onError: (err: any) => {
      setOpen(false)
      const raw = err?.response?.data?.message
      let text: string
      if (typeof raw === 'string') text = raw
      else if (raw && typeof raw === 'object') text = raw[locale as 'de' | 'en' | 'ar'] ?? raw.de ?? raw.en ?? ''
      else text = ''
      if (!text) text = t3(locale, 'Fehler', 'Failed', 'خطأ')
      setToast({ type: 'error', text })
      setTimeout(() => setToast(null), 6000)
    },
  })

  // Stable display string — used both when editable + when readonly
  const label = currentWarehouse?.name ?? t3(locale, '—', '—', '—')

  if (!editable) {
    return (
      <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <WarehouseIcon className="h-3 w-3" />
        <span>{label}</span>
      </div>
    )
  }

  const activeWarehouses = (warehouses ?? []).filter((w) => w.isActive !== false)

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={changeMut.isPending}
        className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md bg-muted/50 hover:bg-muted border border-transparent hover:border-border transition-colors disabled:opacity-50"
        title={t3(locale, 'Lager ändern', 'Change warehouse', 'تغيير المستودع')}
      >
        {changeMut.isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <WarehouseIcon className="h-3 w-3" />
        )}
        <span className="font-medium">{label}</span>
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>

      {open && (
        <>
          {/* backdrop — close on outside click */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 end-0 mt-1 w-56 bg-background border rounded-lg shadow-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
              <span className="text-[11px] font-medium text-muted-foreground">
                {t3(locale, 'Lager wählen', 'Pick warehouse', 'اختر المستودع')}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <div className="max-h-64 overflow-auto">
              {activeWarehouses.length === 0 ? (
                <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                  {t3(
                    locale,
                    'Keine aktiven Lager',
                    'No active warehouses',
                    'لا توجد مستودعات',
                  )}
                </div>
              ) : activeWarehouses.map((w) => {
                const isCurrent = w.id === currentWarehouse?.id
                return (
                  <button
                    key={w.id}
                    type="button"
                    disabled={isCurrent || changeMut.isPending}
                    onClick={() => changeMut.mutate(w.id)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm text-foreground text-start hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-default border-b border-border/50 last:border-b-0 ${isCurrent ? 'bg-muted/30' : ''}`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="text-base">{w.type === 'STORE' ? '🏪' : '📦'}</span>
                      <span className="font-medium">{w.name}</span>
                      {w.isDefault && (
                        <span className="text-[10px] text-muted-foreground">
                          ({t3(locale, 'Standard', 'default', 'افتراضي')})
                        </span>
                      )}
                    </span>
                    {isCurrent && <Check className="h-3 w-3 text-[#d4a853]" />}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}

      {toast && (
        <div
          className={`absolute start-0 top-full mt-1 whitespace-nowrap text-[10px] px-2 py-1 rounded-md shadow-md z-50 ${
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
