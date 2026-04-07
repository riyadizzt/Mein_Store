'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Warehouse, AlertTriangle, Check, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'

const t3 = (l: string, d: string, e: string, a: string) => l === 'ar' ? a : l === 'en' ? e : d

interface Props {
  orderId: string
  currentWarehouseId: string | null
  currentWarehouseName: string | null
  locale: string
}

export function FulfillmentWarehouseSelect({ orderId, currentWarehouseId, locale }: Props) {
  const qc = useQueryClient()
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null)
  const [pendingWarehouseId, setPendingWarehouseId] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])

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
      const msg = err?.response?.data?.message ?? ''
      setToast({ type: 'error', text: typeof msg === 'string' ? msg : t3(locale, 'Fehler beim Lagerwechsel', 'Failed', 'خطأ') })
      setTimeout(() => setToast(null), 4000)
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

      {/* Warning — needs confirmation */}
      {toast?.type === 'warning' && pendingWarehouseId && (
        <div className="mt-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">{toast.text}</p>
              {warnings.length > 0 && (
                <ul className="mt-1 text-[10px] text-amber-700 dark:text-amber-400 space-y-0.5">
                  {warnings.map((w, i) => <li key={i}>• {w}</li>)}
                </ul>
              )}
              <div className="flex gap-2 mt-2">
                <Button size="sm" variant="outline" className="h-7 text-xs rounded-lg" onClick={() => { setPendingWarehouseId(null); setToast(null); setWarnings([]) }}>
                  {t3(locale, 'Abbrechen', 'Cancel', 'إلغاء')}
                </Button>
                <Button size="sm" className="h-7 text-xs rounded-lg bg-amber-600 hover:bg-amber-700 text-white" onClick={handleForceConfirm} disabled={changeMut.isPending}>
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
