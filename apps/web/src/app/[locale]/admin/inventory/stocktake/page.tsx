'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ClipboardList, ArrowLeft, CheckCircle, Clock, XCircle, Package } from 'lucide-react'
import { api } from '@/lib/api'
import { getProductName, formatDateTime } from '@/lib/locale-utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

const STATUS_ICONS: Record<string, any> = { in_progress: Clock, completed: CheckCircle, cancelled: XCircle }
const STATUS_COLORS: Record<string, string> = { in_progress: 'text-blue-600 bg-blue-100', completed: 'text-green-600 bg-green-100', cancelled: 'text-gray-600 bg-gray-100' }

export default function StocktakePage() {
  const locale = useLocale()
  const t = useTranslations('admin')
  const router = useRouter()
  const qc = useQueryClient()

  const [selectedStocktake, setSelectedStocktake] = useState<string | null>(null)
  const [showStartModal, setShowStartModal] = useState(false)
  const [startCategoryId, setStartCategoryId] = useState('')

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

  const defaultWh = (warehouses as any[])?.find((w: any) => w.isDefault)?.id ?? (warehouses as any[])?.[0]?.id

  const { data: detail } = useQuery({
    queryKey: ['stocktake-detail', selectedStocktake],
    queryFn: async () => { const { data } = await api.get(`/admin/stocktakes/${selectedStocktake}`); return data },
    enabled: !!selectedStocktake,
  })

  const startMut = useMutation({
    mutationFn: async () => { const { data } = await api.post('/admin/stocktakes', { warehouseId: defaultWh, categoryId: startCategoryId || null }); return data },
    onSuccess: (data: any) => { qc.invalidateQueries({ queryKey: ['stocktakes'] }); setShowStartModal(false); setSelectedStocktake(data.id) },
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

  const getName = (ts: any[]) => getProductName(ts, locale)
  const fmtDate = (d: string) => formatDateTime(d, locale)

  // Detail view
  if (selectedStocktake && detail) {
    const items = detail.items ?? []
    const counted = items.filter((i: any) => i.actualQty != null).length
    const diffs = items.filter((i: any) => i.difference && i.difference !== 0)

    return (
      <div>
        <AdminBreadcrumb items={[{ label: t('inventory.title'), href: `/${locale}/admin/inventory` }, { label: t('inventory.stocktakeTitle'), href: `/${locale}/admin/inventory/stocktake` }, { label: `#${selectedStocktake.slice(-6)}` }]} />
        <button onClick={() => setSelectedStocktake(null)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 group">
          <ArrowLeft className="h-4 w-4 group-hover:ltr:-translate-x-1 group-hover:rtl:translate-x-1 transition-transform" />{t('inventory.backToOverview')}
        </button>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">{t('inventory.stocktakeTitle')} #{selectedStocktake.slice(-6)}</h1>
            <p className="text-sm text-muted-foreground">{counted}/{items.length} {t('inventory.variant')} | {diffs.length} {t('inventory.stocktakeDiff')}</p>
          </div>
          {detail.status === 'in_progress' && (
            <div className="flex gap-2">
              <Button variant="outline" className="rounded-xl" onClick={() => completeMut.mutate(false)}>{t('inventory.stocktakeComplete')}</Button>
              <Button className="rounded-xl bg-green-600 hover:bg-green-700" onClick={() => completeMut.mutate(true)} disabled={completeMut.isPending}>{t('inventory.stocktakeApply')}</Button>
            </div>
          )}
        </div>

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
                    <tr key={item.id} className={`border-b transition-colors ${hasDiff ? (item.difference > 0 ? 'bg-green-50/50' : 'bg-red-50/50') : 'hover:bg-muted/20'}`}>
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
      </div>
    )
  }

  // List view
  return (
    <div>
      <AdminBreadcrumb items={[{ label: t('inventory.title'), href: `/${locale}/admin/inventory` }, { label: t('inventory.stocktakeTitle') }]} />
      <button onClick={() => router.push(`/${locale}/admin/inventory`)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 group">
        <ArrowLeft className="h-4 w-4 group-hover:ltr:-translate-x-1 group-hover:rtl:translate-x-1 transition-transform" />{t('inventory.backToOverview')}
      </button>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('inventory.stocktakeTitle')}</h1>
        <Button className="rounded-xl gap-2" onClick={() => setShowStartModal(true)}>
          <ClipboardList className="h-4 w-4" />{t('inventory.stocktakeStart')}
        </Button>
      </div>

      <div className="bg-background border rounded-2xl overflow-hidden">
        {(!stocktakes || stocktakes.length === 0) ? (
          <div className="py-16 text-center"><ClipboardList className="h-12 w-12 mx-auto mb-3 text-muted-foreground/20" /><p className="text-muted-foreground">{t('inventory.stocktakeNoItems')}</p></div>
        ) : (
          <div className="divide-y">{(stocktakes as any[]).map((st: any) => {
            const Icon = STATUS_ICONS[st.status] ?? Clock
            return (
              <button key={st.id} onClick={() => setSelectedStocktake(st.id)} className="w-full flex items-center gap-4 px-6 py-4 hover:bg-muted/20 transition-colors text-start">
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${STATUS_COLORS[st.status] ?? 'bg-muted'}`}><Icon className="h-5 w-5" /></div>
                <div className="flex-1">
                  <div className="font-semibold text-sm">#{st.id.slice(-6)}</div>
                  <div className="text-xs text-muted-foreground">{fmtDate(st.createdAt)} | {st._count?.items ?? 0} {t('inventory.variant')}</div>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[st.status]}`}>
                  {t(`inventory.stocktake${st.status === 'in_progress' ? 'InProgress' : st.status === 'completed' ? 'Completed' : 'Cancelled'}`)}
                </span>
              </button>
            )
          })}</div>
        )}
      </div>

      {/* Start Modal */}
      {showStartModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowStartModal(false)} />
          <div className="relative bg-background rounded-2xl p-6 w-full max-w-md shadow-2xl" style={{ animation: 'fadeSlideUp 300ms ease-out' }}>
            <h3 className="text-lg font-bold mb-4">{t('inventory.stocktakeStart')}</h3>
            <div className="space-y-3">
              <div><label className="text-xs font-medium mb-1 block">{t('inventory.stocktakeSelectCategory')}</label>
                <select value={startCategoryId} onChange={(e) => setStartCategoryId(e.target.value)} className="w-full px-3 py-2 rounded-xl border bg-background text-sm">
                  <option value="">{t('inventory.allItems')}</option>
                  {(departments as any[] ?? []).map((d: any) => <option key={d.id} value={d.id}>{getName(d.translations)}</option>)}
                </select>
              </div>
              <div className="flex gap-3"><Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowStartModal(false)}>{t('inventory.cancel')}</Button>
                <Button className="flex-1 rounded-xl" disabled={!defaultWh || startMut.isPending} onClick={() => startMut.mutate()}>{t('inventory.stocktakeStart')}</Button></div>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes fadeSlideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  )
}
