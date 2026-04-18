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
import { Warehouse as WarehouseIcon, Loader2, ChevronDown } from 'lucide-react'
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
  // Order status flows through for the read-only tooltip so the admin
  // understands WHY the picker is locked after payment capture. Required
  // to match the backend guard WarehouseChangeBlockedAfterCapture.
  orderStatus?: string
}

export function LineWarehousePicker({ orderId, itemId, currentWarehouse, editable, locale, orderStatus }: Props) {
  const qc = useQueryClient()
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
    // Distinguish "post-capture lock" from "end-state (shipped/delivered/
    // cancelled)" so the tooltip tells the admin the specific reason.
    // Both land on the same read-only badge visually — only the title
    // differs. Post-capture = confirmed/processing: goods have left the
    // source warehouse via sale_online, move-reservation would drift.
    // End-state: the order is terminal, no edits make sense.
    const isPostCapture = orderStatus === 'confirmed' || orderStatus === 'processing'
    const tooltip = isPostCapture
      ? t3(
          locale,
          'Lager kann nach Zahlungsbestätigung nicht mehr geändert werden. Ware wurde bereits aus dem Lager abgebucht.',
          'Warehouse cannot be changed after payment capture. Stock has already been deducted from this warehouse.',
          'لا يمكن تغيير المستودع بعد تأكيد الدفع. تم خصم البضائع بالفعل من المستودع.',
        )
      : t3(
          locale,
          'Lager-Zuordnung in diesem Status nicht änderbar.',
          'Warehouse assignment is not editable in this status.',
          'لا يمكن تعديل تعيين المستودع في هذه الحالة.',
        )
    return (
      <div
        className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-help"
        title={tooltip}
      >
        <WarehouseIcon className="h-3 w-3" />
        <span>{label}</span>
      </div>
    )
  }

  const activeWarehouses = (warehouses ?? []).filter((w) => w.isActive !== false)

  // Native <select> — browser-handled, bulletproof across all RTL/overflow/
  // z-index edge cases. The custom dropdown that was here before had
  // positioning issues in certain container contexts (dropdown rendering
  // but items invisible). A native select pops up above the viewport, always
  // visible, always keyboard-accessible. Tradeoff: slightly less branded look,
  // but 100% reliable.
  return (
    <div className="relative inline-block">
      <div
        className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md bg-muted/50 hover:bg-muted border border-transparent hover:border-border transition-colors focus-within:border-[#d4a853] focus-within:ring-1 focus-within:ring-[#d4a853]/30"
        title={t3(locale, 'Lager ändern', 'Change warehouse', 'تغيير المستودع')}
      >
        {changeMut.isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <WarehouseIcon className="h-3 w-3" />
        )}
        <span className="font-medium">{label}</span>
        <select
          value={currentWarehouse?.id ?? ''}
          onChange={(e) => {
            const newId = e.target.value
            if (newId && newId !== currentWarehouse?.id) {
              changeMut.mutate(newId)
            }
          }}
          disabled={changeMut.isPending || activeWarehouses.length === 0}
          className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
          aria-label={t3(locale, 'Lager ändern', 'Change warehouse', 'تغيير المستودع')}
        >
          {currentWarehouse && (
            <option value={currentWarehouse.id} disabled>
              {currentWarehouse.name}
            </option>
          )}
          {activeWarehouses
            .filter((w) => w.id !== currentWarehouse?.id)
            .map((w) => (
              <option key={w.id} value={w.id}>
                {w.type === 'STORE' ? '🏪 ' : '📦 '}{w.name}
                {w.isDefault ? ` (${t3(locale, 'Standard', 'default', 'افتراضي')})` : ''}
              </option>
            ))}
        </select>
        <ChevronDown className="h-3 w-3 opacity-60" />
      </div>

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
