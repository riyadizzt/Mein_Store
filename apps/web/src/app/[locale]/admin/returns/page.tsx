'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, Loader2, X, ExternalLink, Clock, Package, CreditCard, Truck } from 'lucide-react'
import { api } from '@/lib/api'
import { formatDate, formatDateTime, formatCurrency } from '@/lib/locale-utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

const STATUS_COLORS: Record<string, string> = {
  requested: 'bg-yellow-100 text-yellow-800',
  label_sent: 'bg-blue-100 text-blue-800',
  in_transit: 'bg-purple-100 text-purple-800',
  received: 'bg-teal-100 text-teal-800',
  inspected: 'bg-indigo-100 text-indigo-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  refunded: 'bg-orange-100 text-orange-800',
}

const STATUS_KEYS = ['requested', 'label_sent', 'in_transit', 'received', 'inspected', 'approved', 'rejected', 'refunded']

const NEXT_STATUS: Record<string, string[]> = {
  requested: ['label_sent', 'rejected'],
  label_sent: ['in_transit', 'rejected'],
  in_transit: ['received'],
  received: ['inspected'],
  inspected: ['approved', 'rejected'],
  approved: ['refunded'],
}

export default function AdminReturnsPage() {
  const locale = useLocale()
  const t = useTranslations('admin')
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newStatus, setNewStatus] = useState('')
  const [statusNotes, setStatusNotes] = useState('')
  const [trackingNum, setTrackingNum] = useState('')
  const [labelUrl, setLabelUrl] = useState('')

  const { data: returns, isLoading } = useQuery({
    queryKey: ['admin-returns', statusFilter, search],
    queryFn: async () => {
      const params: Record<string, string> = { limit: '100' }
      if (statusFilter) params.status = statusFilter
      if (search) params.search = search
      const { data } = await api.get('/admin/returns', { params })
      return data
    },
  })

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['admin-return', selectedId],
    queryFn: async () => { const { data } = await api.get(`/admin/returns/${selectedId}`); return data },
    enabled: !!selectedId,
  })

  const statusMutation = useMutation({
    mutationFn: () => api.patch(`/admin/returns/${selectedId}/status`, { status: newStatus, notes: statusNotes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-returns'] })
      qc.invalidateQueries({ queryKey: ['admin-return', selectedId] })
      setNewStatus(''); setStatusNotes('')
    },
  })

  const labelMutation = useMutation({
    mutationFn: () => api.patch(`/admin/returns/${selectedId}/label`, { returnTrackingNumber: trackingNum, returnLabelUrl: labelUrl }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-return', selectedId] }),
  })

  const openDetail = (ret: any) => {
    setSelectedId(ret.id)
    setTrackingNum(ret.returnTrackingNumber ?? '')
    setLabelUrl(ret.returnLabelUrl ?? '')
    setNewStatus(''); setStatusNotes('')
  }

  const getDaysLeft = (deadline: string | null) => {
    if (!deadline) return null
    return Math.ceil((new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  }

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t('returns.title') }]} />
      <h1 className="text-2xl font-bold mb-6">{t('returns.title')}</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder={t('returns.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-10 px-3 rounded-lg border bg-background text-sm min-w-[160px]">
          <option value="">{t('returns.allStatus')}</option>
          {STATUS_KEYS.map((s) => <option key={s} value={s}>{t(`returns.status_${s}`)}</option>)}
        </select>
      </div>

      <div className="flex gap-6 items-start">
        {/* Table */}
        <div className="flex-1 bg-background border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium">{t('returns.order')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('returns.customer')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('returns.reason')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('returns.status')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('returns.deadline')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('returns.date')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b">{Array.from({ length: 6 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>)}</tr>
                  ))
                ) : (returns ?? []).length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">{t('returns.noReturns')}</td></tr>
                ) : (
                  (returns ?? []).map((ret: any) => {
                    const days = getDaysLeft(ret.deadline)
                    return (
                      <tr key={ret.id} className={`border-b cursor-pointer transition-colors ${selectedId === ret.id ? 'bg-primary/5' : 'hover:bg-muted/30'}`} onClick={() => openDetail(ret)}>
                        <td className="px-4 py-3 font-mono font-medium text-primary">{ret.order?.orderNumber}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium">{ret.order?.user?.firstName} {ret.order?.user?.lastName}</p>
                          <p className="text-xs text-muted-foreground">{ret.order?.user?.email}</p>
                        </td>
                        <td className="px-4 py-3 text-sm">{t(`returns.reason_${ret.reason}`)}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[ret.status] ?? 'bg-gray-100'}`}>
                            {t(`returns.status_${ret.status}`)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {days !== null ? (
                            <span className={`text-xs font-medium ${days <= 0 ? 'text-red-600' : days <= 3 ? 'text-orange-600' : 'text-green-600'}`}>
                              {days <= 0 ? t('returns.expired') : t('returns.daysLeft', { days })}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-sm">{formatDate(ret.createdAt, locale)}</td>
                      </tr>
                    )
                  })
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
                  <h3 className="font-bold text-lg">{t('returns.details')}</h3>
                  <button onClick={() => setSelectedId(null)}><X className="h-4 w-4" /></button>
                </div>

                {/* Order Info */}
                <div className="bg-muted/30 rounded-lg p-3 space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('returns.order')}</span><span className="font-mono font-medium">{detail.order?.orderNumber}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('returns.customer')}</span><span>{detail.order?.user?.firstName} {detail.order?.user?.lastName}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('returns.reason')}</span><span>{t(`returns.reason_${detail.reason}`)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('returns.status')}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[detail.status]}`}>{t(`returns.status_${detail.status}`)}</span>
                  </div>
                  {detail.notes && <div className="pt-1 border-t text-xs text-muted-foreground">{detail.notes}</div>}
                </div>

                {/* 14-Day Countdown */}
                {detail.deadline && (() => {
                  const days = getDaysLeft(detail.deadline)
                  return (
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">{t('returns.deadline')}:</span>
                      <span className={`font-medium ${days !== null && days <= 0 ? 'text-red-600' : days !== null && days <= 3 ? 'text-orange-600' : 'text-green-600'}`}>
                        {days !== null && days <= 0 ? t('returns.expired') : days !== null ? t('returns.daysLeft', { days }) : '—'}
                      </span>
                    </div>
                  )
                })()}

                {/* Items */}
                <div>
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><Package className="h-3.5 w-3.5" />{t('returns.items')}</h4>
                  <div className="space-y-2">
                    {(detail.order?.items ?? []).map((item: any) => (
                      <div key={item.id} className="flex justify-between text-sm bg-muted/20 rounded-lg px-3 py-2">
                        <div>
                          <p className="font-medium">{item.snapshotName}</p>
                          <p className="text-xs text-muted-foreground">{item.snapshotSku} {item.variant?.color ? `/ ${item.variant.color}` : ''} {item.variant?.size ? `/ ${item.variant.size}` : ''}</p>
                        </div>
                        <div className="text-right text-xs">
                          <p>{item.quantity}x</p>
                          <p className="font-medium">{formatCurrency(Number(item.totalPrice), locale)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Timestamps + Refund */}
                <div className="text-xs space-y-1 text-muted-foreground">
                  {detail.receivedAt && <p>{t('returns.receivedAt')}: {formatDateTime(detail.receivedAt, locale)}</p>}
                  {detail.refundedAt && <p>{t('returns.refundedAt')}: {formatDateTime(detail.refundedAt, locale)}</p>}
                  {detail.refundAmount && (
                    <p className="flex items-center gap-1"><CreditCard className="h-3 w-3" />{t('returns.refundAmount')}: {formatCurrency(Number(detail.refundAmount), locale)}</p>
                  )}
                </div>

                {/* Return Label */}
                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><Truck className="h-3.5 w-3.5" />{t('returns.label')}</h4>
                  <div className="space-y-2">
                    <div>
                      <label className="text-xs text-muted-foreground">{t('returns.trackingNumber')}</label>
                      <Input value={trackingNum} onChange={(e) => setTrackingNum(e.target.value)} className="text-xs font-mono" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">{t('returns.labelUrl')}</label>
                      <Input value={labelUrl} onChange={(e) => setLabelUrl(e.target.value)} className="text-xs" />
                    </div>
                    {labelUrl && (
                      <a href={labelUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary flex items-center gap-1 hover:underline">
                        <ExternalLink className="h-3 w-3" />{t('returns.label')}
                      </a>
                    )}
                    <Button size="sm" variant="outline" className="w-full" onClick={() => labelMutation.mutate()} disabled={labelMutation.isPending}>
                      {labelMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                      {t('returns.saveLabel')}
                    </Button>
                  </div>
                </div>

                {/* Status Change */}
                {NEXT_STATUS[detail.status] && (
                  <div className="border-t pt-4">
                    <h4 className="text-sm font-semibold mb-2">{t('returns.changeStatus')}</h4>
                    <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)} className="w-full h-9 px-3 rounded-lg border bg-background text-sm mb-2">
                      <option value="">{t('returns.selectStatus')}</option>
                      {(NEXT_STATUS[detail.status] ?? []).map((s) => (
                        <option key={s} value={s}>{t(`returns.status_${s}`)}</option>
                      ))}
                    </select>
                    <Input value={statusNotes} onChange={(e) => setStatusNotes(e.target.value)} placeholder={t('returns.notes')} className="mb-2" />
                    <Button size="sm" className="w-full" disabled={!newStatus || statusMutation.isPending} onClick={() => statusMutation.mutate()}>
                      {statusMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                      {t('returns.updateStatus')}
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
