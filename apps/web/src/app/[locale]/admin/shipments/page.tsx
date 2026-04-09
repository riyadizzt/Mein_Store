'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, Loader2, X, ExternalLink, Download, Package, MapPin, Truck } from 'lucide-react'
import { api } from '@/lib/api'
import { formatDate, formatDateTime } from '@/lib/locale-utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  label_created: 'bg-blue-100 text-blue-800',
  picked_up: 'bg-indigo-100 text-indigo-800',
  in_transit: 'bg-purple-100 text-purple-800',
  out_for_delivery: 'bg-yellow-100 text-yellow-800',
  delivered: 'bg-green-100 text-green-800',
  failed_attempt: 'bg-red-100 text-red-800',
  returned_to_sender: 'bg-orange-100 text-orange-800',
  cancelled: 'bg-gray-100 text-gray-500',
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
        <Button size="sm" className="gap-1.5" onClick={() => batchMutation.mutate()} disabled={batchMutation.isPending}>
          {batchMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Truck className="h-3.5 w-3.5" />}
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
                <col style={{ width: '20%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '10%' }} />
              </colgroup>
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-start px-4 py-3 text-sm font-semibold">{t('shipments.order')}</th>
                  <th className="text-start px-4 py-3 text-sm font-semibold">{t('shipments.customer')}</th>
                  <th className="text-start px-4 py-3 text-sm font-semibold">{t('shipments.carrier')}</th>
                  <th className="text-start px-4 py-3 text-sm font-semibold">{t('shipments.tracking')}</th>
                  <th className="text-start px-4 py-3 text-sm font-semibold">{t('shipments.status')}</th>
                  <th className="text-start px-4 py-3 text-sm font-semibold">{t('shipments.date')}</th>
                  <th className="text-end px-4 py-3 text-sm font-semibold">{t('shipments.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b">{Array.from({ length: 7 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>)}</tr>
                  ))
                ) : (shipments ?? []).length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">{t('shipments.noShipments')}</td></tr>
                ) : (
                  (shipments ?? []).map((s: any) => (
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
                      <td className="px-4 py-3 text-muted-foreground text-sm">{formatDate(s.createdAt, locale)}</td>
                      <td className="px-4 py-3 text-end">
                        {s.labelUrl && (
                          <a href={s.labelUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                            <Download className="h-3 w-3" />{t('shipments.downloadLabel')}
                          </a>
                        )}
                      </td>
                    </tr>
                  ))
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
    </div>
  )
}
