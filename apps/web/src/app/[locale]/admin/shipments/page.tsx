'use client'

import { API_BASE_URL } from '@/lib/env'
import React, { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, Loader2, X, ExternalLink, Download, Package, MapPin, Truck, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import { formatDate, formatDateTime } from '@/lib/locale-utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-500/20 text-gray-700 font-semibold',
  label_created: 'bg-blue-500/20 text-blue-700 font-semibold',
  picked_up: 'bg-indigo-500/20 text-indigo-700 font-semibold',
  in_transit: 'bg-purple-500/20 text-purple-700 font-semibold',
  out_for_delivery: 'bg-amber-500/20 text-amber-700 font-semibold',
  delivered: 'bg-green-500/20 text-green-700 font-semibold',
  failed_attempt: 'bg-red-500/20 text-red-700 font-semibold',
  returned_to_sender: 'bg-orange-500/20 text-orange-700 font-semibold',
  cancelled: 'bg-red-500/15 text-red-500 font-semibold line-through',
}

const STATUS_KEYS = ['pending', 'label_created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed_attempt', 'returned_to_sender', 'cancelled']

const NEXT_STATUS: Record<string, string[]> = {
  pending: ['label_created', 'cancelled'],
  label_created: ['picked_up', 'in_transit', 'cancelled'],
  picked_up: ['in_transit'],
  in_transit: ['out_for_delivery', 'delivered'],
  out_for_delivery: ['delivered', 'failed_attempt'],
  failed_attempt: ['in_transit', 'returned_to_sender'],
}

export default function AdminShipmentsPage() {
  const locale = useLocale()
  const t = useTranslations('admin')
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [carrierFilter, setCarrierFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newStatus, setNewStatus] = useState('')
  const [trackingNum, setTrackingNum] = useState('')
  const [trackingUrl, setTrackingUrl] = useState('')
  const [labelUrl, setLabelUrl] = useState('')
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set())
  const [showBatchDialog, setShowBatchDialog] = useState(false)
  const [batchOrders, setBatchOrders] = useState<any[]>([])
  const [batchExcluded, setBatchExcluded] = useState<Set<string>>(new Set())
  const [batchLoading, setBatchLoading] = useState(false)

  const { data: shipments, isLoading } = useQuery({
    queryKey: ['admin-shipments', statusFilter, carrierFilter, search],
    queryFn: async () => {
      const params: Record<string, string> = { limit: '100' }
      if (statusFilter) params.status = statusFilter
      if (carrierFilter) params.carrier = carrierFilter
      if (search) params.search = search
      const { data } = await api.get('/admin/shipments', { params })
      return data
    },
  })

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['admin-shipment', selectedId],
    queryFn: async () => { const { data } = await api.get(`/admin/shipments/${selectedId}`); return data },
    enabled: !!selectedId,
  })

  const statusMutation = useMutation({
    mutationFn: () => api.patch(`/admin/shipments/${selectedId}/status`, { status: newStatus }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-shipments'] })
      qc.invalidateQueries({ queryKey: ['admin-shipment', selectedId] })
      setNewStatus('')
    },
  })

  const trackingMutation = useMutation({
    mutationFn: () => api.patch(`/admin/shipments/${selectedId}/tracking`, { trackingNumber: trackingNum, trackingUrl, labelUrl }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-shipment', selectedId] }),
  })

  const batchMutation = useMutation({
    mutationFn: () => api.post('/admin/shipments/batch'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-shipments'] }),
  })

  const cancelMutation = useMutation({
    mutationFn: (orderId: string) => api.post(`/admin/shipments/${orderId}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-shipments'] }),
  })

  const openDetail = (s: any) => {
    setSelectedId(s.id)
    setTrackingNum(s.trackingNumber ?? '')
    setTrackingUrl(s.trackingUrl ?? '')
    setLabelUrl(s.labelUrl ?? '')
    setNewStatus('')
  }

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t('shipments.title') }]} />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('shipments.title')}</h1>
        <Button size="sm" className="gap-1.5" disabled={batchMutation.isPending || batchLoading} onClick={async () => {
          setBatchLoading(true)
          try {
            const { data } = await api.get('/admin/orders', { params: { status: 'confirmed,processing', hasShipment: 'false', limit: 50 } })
            const orders = data?.items ?? data?.data ?? (Array.isArray(data) ? data : [])
            setBatchOrders(orders)
            setBatchExcluded(new Set())
            setShowBatchDialog(true)
          } catch {}
          setBatchLoading(false)
        }}>
          {(batchMutation.isPending || batchLoading) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Truck className="h-3.5 w-3.5" />}
          {t('shipments.batchCreate')}
        </Button>
      </div>

      {batchMutation.data && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
          {t('shipments.batchResult', { created: (batchMutation.data as any)?.data?.created ?? 0, total: (batchMutation.data as any)?.data?.total ?? 0 })}
        </div>
      )}

      {/* Address warnings from shipment creation */}
      {(shipments ?? []).some((s: any) => s.addressWarnings?.length > 0) && (
        <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg text-sm text-amber-800 dark:text-amber-300 flex items-center gap-2">
          <span className="text-amber-500">⚠</span>
          {locale === 'ar' ? 'بعض العناوين لم يتم التحقق منها بواسطة DHL — يرجى المراجعة' : locale === 'en' ? 'Some addresses could not be verified by DHL — please review' : 'Einige Adressen konnten nicht von DHL verifiziert werden — bitte prüfen'}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder={t('shipments.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-10 px-3 rounded-lg border bg-background text-sm min-w-[160px]">
          <option value="">{t('shipments.allStatus')}</option>
          {STATUS_KEYS.map((s) => <option key={s} value={s}>{t(`shipments.status_${s}`)}</option>)}
        </select>
        <select value={carrierFilter} onChange={(e) => setCarrierFilter(e.target.value)} className="h-10 px-3 rounded-lg border bg-background text-sm">
          <option value="">{t('shipments.allCarriers')}</option>
          <option value="dhl">DHL</option>
          <option value="dpd">DPD</option>
        </select>
      </div>

      <div className="flex gap-6 items-start">
        {/* Table */}
        <div className="flex-1 bg-background border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <colgroup>
                <col style={{ width: '22%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '15%' }} />
              </colgroup>
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-start px-4 py-3 text-sm font-semibold">{t('shipments.order')}</th>
                  <th className="text-start px-4 py-3 text-sm font-semibold">{t('shipments.customer')}</th>
                  <th className="text-start px-4 py-3 text-sm font-semibold">{t('shipments.carrier')}</th>
                  <th className="text-start px-4 py-3 text-sm font-semibold">{t('shipments.tracking')}</th>
                  <th className="text-start px-4 py-3 text-sm font-semibold">{t('shipments.status')}</th>
                  <th className="text-end px-4 py-3 text-sm font-semibold">{t('shipments.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b">{Array.from({ length: 6 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>)}</tr>
                  ))
                ) : (shipments ?? []).length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">{t('shipments.noShipments')}</td></tr>
                ) : (
                  (() => {
                    // Group shipments by date
                    const grouped: Record<string, any[]> = {}
                    for (const s of (shipments ?? []) as any[]) {
                      const dateKey = s.createdAt ? new Date(s.createdAt).toISOString().slice(0, 10) : 'unknown'
                      if (!grouped[dateKey]) grouped[dateKey] = []
                      grouped[dateKey].push(s)
                    }
                    return Object.entries(grouped).map(([dateKey, items]) => (
                      <React.Fragment key={dateKey}>
                        <tr className="bg-[#d4a853]/5 border-b cursor-pointer hover:bg-[#d4a853]/10 transition-colors" onClick={() => setCollapsedDays(prev => { const next = new Set(prev); if (next.has(dateKey)) next.delete(dateKey); else next.add(dateKey); return next })}>
                          <td colSpan={6} className="px-4 py-2.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {collapsedDays.has(dateKey) ? <ChevronRight className="h-4 w-4 text-[#d4a853]" /> : <ChevronDown className="h-4 w-4 text-[#d4a853]" />}
                                <span className="text-sm font-bold text-[#d4a853]">{formatDate(dateKey, locale)}</span>
                              </div>
                              <span className="text-xs text-muted-foreground">{items.length} {locale === 'ar' ? 'شحنة' : 'Sendungen'}</span>
                            </div>
                          </td>
                        </tr>
                        {!collapsedDays.has(dateKey) && items.map((s: any) => (
                    <tr key={s.id} className={`border-b cursor-pointer transition-colors ${selectedId === s.id ? 'bg-primary/5' : 'hover:bg-muted/30'}`} onClick={() => openDetail(s)}>
                      <td className="px-4 py-3 font-mono font-medium text-primary">{s.order?.orderNumber}</td>
                      <td className="px-4 py-3"><p className="font-medium">{s.order?.user?.firstName} {s.order?.user?.lastName}</p></td>
                      <td className="px-4 py-3 uppercase text-xs font-bold">{s.carrier}</td>
                      <td className="px-4 py-3">
                        {s.trackingNumber ? (
                          <a href={s.trackingUrl ?? `https://www.dhl.de/de/privatkunden/dhl-sendungsverfolgung.html?piececode=${s.trackingNumber}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-primary hover:underline flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            {s.trackingNumber} <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[s.status] ?? 'bg-gray-100'}`}>{t(`shipments.status_${s.status}`)}</span>
                      </td>
                      <td className="px-4 py-3 text-end">
                        <div className="flex items-center justify-end gap-2">
                          {s.labelUrl && s.trackingNumber && (
                            <button className="inline-flex items-center gap-1 text-xs text-[#d4a853] hover:underline" onClick={async (e) => {
                              e.stopPropagation()
                              try {
                                const token = (await import('@/store/auth-store')).useAuthStore.getState().adminAccessToken
                                const API = API_BASE_URL
                                const res = await fetch(`${API}${s.labelUrl}`, { headers: { Authorization: `Bearer ${token}` } })
                                if (!res.ok) return
                                const blob = await res.blob()
                                const url = URL.createObjectURL(blob)
                                const a = document.createElement('a')
                                a.href = url; a.download = `label-${s.trackingNumber}.pdf`
                                document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
                              } catch {}
                            }}>
                              <Download className="h-3 w-3" />{t('shipments.downloadLabel')}
                            </button>
                          )}
                          {['pending', 'label_created'].includes(s.status) && (
                            <button className="inline-flex items-center gap-1 text-xs text-destructive hover:underline" onClick={(e) => { e.stopPropagation(); cancelMutation.mutate(s.order?.id) }}>
                              {t('shipments.cancel')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                        ))}
                      </React.Fragment>
                    ))
                  })()
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detail Panel */}
        {selectedId && (
          <div className="w-96 flex-shrink-0 bg-background border rounded-xl">
            {detailLoading ? (
              <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : detail ? (
              <div className="p-5 space-y-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-lg">{t('shipments.details')}</h3>
                  <button onClick={() => setSelectedId(null)}><X className="h-4 w-4" /></button>
                </div>

                <div className="bg-muted/30 rounded-lg p-3 space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('shipments.order')}</span><span className="font-mono font-medium">{detail.order?.orderNumber}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('shipments.customer')}</span><span>{detail.order?.user?.firstName} {detail.order?.user?.lastName}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('shipments.carrier')}</span><span className="uppercase font-bold text-xs">{detail.carrier}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('shipments.status')}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[detail.status]}`}>{t(`shipments.status_${detail.status}`)}</span>
                  </div>
                </div>

                {detail.order?.shippingAddress && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{t('shipments.address')}</h4>
                    <div className="text-sm text-muted-foreground bg-muted/20 rounded-lg p-3">
                      <p>{detail.order.shippingAddress.firstName} {detail.order.shippingAddress.lastName}</p>
                      <p>{detail.order.shippingAddress.street} {detail.order.shippingAddress.houseNumber}</p>
                      <p>{detail.order.shippingAddress.postalCode} {detail.order.shippingAddress.city}</p>
                    </div>
                  </div>
                )}

                <div>
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><Package className="h-3.5 w-3.5" />{t('shipments.items')}</h4>
                  <div className="space-y-1">
                    {(detail.order?.items ?? []).map((item: any, i: number) => (
                      <div key={i} className="flex justify-between text-sm bg-muted/20 rounded-lg px-3 py-2">
                        <div><p className="font-medium">{item.snapshotName}</p><p className="text-xs text-muted-foreground">{item.snapshotSku}</p></div>
                        <span className="text-xs">{item.quantity}x</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="text-xs space-y-1 text-muted-foreground">
                  {detail.shippedAt && <p>{t('shipments.shippedAt')}: {formatDateTime(detail.shippedAt, locale)}</p>}
                  {detail.deliveredAt && <p>{t('shipments.deliveredAt')}: {formatDateTime(detail.deliveredAt, locale)}</p>}
                </div>

                {/* Tracking */}
                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><Truck className="h-3.5 w-3.5" />{t('shipments.tracking')}</h4>
                  <div className="space-y-2">
                    <div><label className="text-xs text-muted-foreground">{t('shipments.trackingNumber')}</label><Input value={trackingNum} onChange={(e) => setTrackingNum(e.target.value)} className="text-xs font-mono" /></div>
                    <div><label className="text-xs text-muted-foreground">{t('shipments.labelUrl')}</label><Input value={labelUrl} onChange={(e) => setLabelUrl(e.target.value)} className="text-xs" /></div>
                    {trackingNum && (
                      <a href={trackingUrl || `https://www.dhl.de/de/privatkunden/dhl-sendungsverfolgung.html?piececode=${trackingNum}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary flex items-center gap-1 hover:underline">
                        <ExternalLink className="h-3 w-3" />{t('shipments.trackDhl')}
                      </a>
                    )}
                    <Button size="sm" variant="outline" className="w-full" onClick={() => trackingMutation.mutate()} disabled={trackingMutation.isPending}>
                      {trackingMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}{t('shipments.saveTracking')}
                    </Button>
                  </div>
                </div>

                {/* Status Change */}
                {NEXT_STATUS[detail.status] && (
                  <div className="border-t pt-4">
                    <h4 className="text-sm font-semibold mb-2">{t('shipments.changeStatus')}</h4>
                    <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)} className="w-full h-9 px-3 rounded-lg border bg-background text-sm mb-2">
                      <option value="">{t('shipments.selectStatus')}</option>
                      {(NEXT_STATUS[detail.status] ?? []).map((s) => <option key={s} value={s}>{t(`shipments.status_${s}`)}</option>)}
                    </select>
                    <Button size="sm" className="w-full" disabled={!newStatus || statusMutation.isPending} onClick={() => statusMutation.mutate()}>
                      {statusMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}{t('shipments.updateStatus')}
                    </Button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* ── Batch Ship Dialog ─────────────────────────────── */}
      {showBatchDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowBatchDialog(false)} />
          <div className="relative bg-background rounded-2xl p-6 w-full max-w-2xl shadow-2xl border max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">{locale === 'ar' ? 'شحن جميع الطلبات الجاهزة' : 'Alle Bestellungen versenden'}</h3>
              <button onClick={() => setShowBatchDialog(false)}><X className="h-5 w-5" /></button>
            </div>

            {batchOrders.length === 0 ? (
              <p className="text-muted-foreground text-sm py-8 text-center">{locale === 'ar' ? 'لا توجد طلبات جاهزة للشحن' : 'Keine Bestellungen bereit zum Versand'}</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground mb-4">
                  {locale === 'ar'
                    ? `${batchOrders.length} طلب جاهز. قم بإلغاء تحديد الطلبات التي لا تريد شحنها.`
                    : `${batchOrders.length} Bestellungen bereit. Entfernen Sie Bestellungen die nicht versendet werden sollen.`}
                </p>

                <div className="space-y-2 mb-4">
                  {batchOrders.map((order: any) => {
                    const addr = order.shippingAddress
                    const excluded = batchExcluded.has(order.id)
                    const hasWarning = !addr || !addr.street || addr.street.length < 3 || !addr.houseNumber || !addr.city || addr.city.length < 2 || (addr.country === 'DE' && !/^\d{5}$/.test(addr.postalCode ?? ''))
                    return (
                      <div key={order.id} className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${excluded ? 'opacity-40 bg-muted/30' : hasWarning ? 'bg-amber-50 border-amber-200' : 'bg-background'}`}>
                        <input type="checkbox" checked={!excluded} onChange={() => {
                          setBatchExcluded(prev => { const next = new Set(prev); if (next.has(order.id)) next.delete(order.id); else next.add(order.id); return next })
                        }} className="mt-1 h-4 w-4 rounded" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-medium">{order.orderNumber}</span>
                            <span className="text-xs text-muted-foreground">{order.user?.firstName} {order.user?.lastName}</span>
                            {hasWarning && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                          </div>
                          {addr ? (
                            <p className="text-xs text-muted-foreground mt-0.5">{addr.street} {addr.houseNumber}, {addr.postalCode} {addr.city}, {addr.country}</p>
                          ) : (
                            <p className="text-xs text-red-500 mt-0.5">{locale === 'ar' ? 'لا يوجد عنوان شحن!' : 'Keine Lieferadresse!'}</p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="flex gap-3 pt-2 border-t">
                  <Button className="flex-1 gap-2 bg-[#d4a853] text-white hover:bg-[#c49b45] rounded-xl" disabled={batchMutation.isPending}
                    onClick={() => {
                      batchMutation.mutate()
                      setShowBatchDialog(false)
                    }}>
                    {batchMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                    {locale === 'ar' ? `شحن ${batchOrders.length - batchExcluded.size} طلب` : `${batchOrders.length - batchExcluded.size} Bestellungen versenden`}
                  </Button>
                  <Button variant="outline" className="rounded-xl" onClick={() => setShowBatchDialog(false)}>
                    {locale === 'ar' ? 'إلغاء' : 'Abbrechen'}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
