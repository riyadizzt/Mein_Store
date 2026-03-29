'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import Image from 'next/image'
import { Check, Truck, Download, Ban, Loader2, ExternalLink, StickyNote } from 'lucide-react'
import { api } from '@/lib/api'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/locale-utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

export default function AdminOrderDetailPage({ params: { id } }: { params: { id: string; locale: string } }) {
  const locale = useLocale()
  const t = useTranslations('admin')
  const queryClient = useQueryClient()
  const [notes, setNotes] = useState('')
  const [statusChange, setStatusChange] = useState('')
  const [statusNotes, setStatusNotes] = useState('')
  const [cancelReason, setCancelReason] = useState('')

  const { data: order, isLoading } = useQuery({
    queryKey: ['admin-order', id],
    queryFn: async () => { const { data } = await api.get(`/admin/orders/${id}`); return data },
  })

  const statusMutation = useMutation({
    mutationFn: () => api.patch(`/admin/orders/${id}/status`, { status: statusChange, notes: statusNotes }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-order', id] }); setStatusChange(''); setStatusNotes('') },
  })

  const cancelMutation = useMutation({
    mutationFn: () => api.post(`/admin/orders/${id}/cancel`, { reason: cancelReason }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-order', id] }); setCancelReason('') },
  })

  const noteMutation = useMutation({
    mutationFn: () => api.post(`/admin/orders/${id}/notes`, { content: notes }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-order', id] }); setNotes('') },
  })

  if (isLoading) return <div className="space-y-4">{[1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse bg-muted rounded-xl" />)}</div>
  if (!order) return <p>{t('orders.notFound')}</p>

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t('orders.title'), href: `/${locale}/admin/orders` }, { label: order?.orderNumber ?? '...' }]} />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold font-mono">{order.orderNumber}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {formatDate(order.createdAt, locale)} — Kunde: {order.user?.firstName ?? (() => { try { return JSON.parse(order.notes ?? '{}').guestFirstName } catch { return '' } })()} {order.user?.lastName ?? (() => { try { return JSON.parse(order.notes ?? '{}').guestLastName } catch { return '' } })()} ({order.user?.email ?? order.guestEmail ?? t('users.guest')})
            {(() => { try { const loc = JSON.parse(order.notes ?? '{}').locale ?? order.user?.preferredLang; return loc ? <span className={`ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded ${loc === 'ar' ? 'bg-green-100 text-green-800' : loc === 'en' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'}`}>{loc.toUpperCase()}</span> : null } catch { return null } })()}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Items */}
          <div className="bg-background border rounded-xl p-5">
            <h3 className="font-semibold mb-4">{t('orders.items')}</h3>
            <div className="divide-y">
              {(order.items ?? []).map((item: any) => (
                <div key={item.id} className="flex gap-3 py-3">
                  <div className="w-12 h-12 bg-muted rounded overflow-hidden flex-shrink-0">
                    {item.variant?.product?.images?.[0]?.url && (
                      <Image src={item.variant.product.images[0].url} alt="" width={48} height={48} className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{item.snapshotName}</p>
                    <p className="text-xs text-muted-foreground">{item.snapshotSku} {item.variant?.color ? `/ ${item.variant.color}` : ''} {item.variant?.size ? `/ ${item.variant.size}` : ''}</p>
                  </div>
                  <div className="text-right text-sm">
                    <p>{item.quantity} × {formatCurrency(Number(item.unitPrice), locale)}</p>
                    <p className="font-semibold">{formatCurrency(Number(item.totalPrice), locale)}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t pt-3 mt-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">{t('orders.subtotal')}</span><span>{formatCurrency(Number(order.subtotal), locale)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('orders.shipping')}</span><span>{formatCurrency(Number(order.shippingCost), locale)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('orders.tax')}</span><span>{formatCurrency(Number(order.taxAmount), locale)}</span></div>
              <div className="flex justify-between font-bold text-base pt-1 border-t"><span>{t('orders.total')}</span><span>{formatCurrency(Number(order.totalAmount), locale)}</span></div>
            </div>
          </div>

          {/* Status Timeline */}
          <div className="bg-background border rounded-xl p-5">
            <h3 className="font-semibold mb-4">{t('orders.statusHistory')}</h3>
            <div className="space-y-3">
              {(order.statusHistory ?? []).map((h: any) => (
                <div key={h.id} className="flex items-start gap-3">
                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Check className="h-3 w-3 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{h.fromStatus ?? '—'} → {h.toStatus}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(h.createdAt, locale)} — {h.source} {h.notes ? `— ${h.notes}` : ''}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Internal Notes */}
          <div className="bg-background border rounded-xl p-5">
            <h3 className="font-semibold mb-4 flex items-center gap-2"><StickyNote className="h-4 w-4" />{t('orders.internalNotes')}</h3>
            {(order.adminNotes ?? []).map((note: any) => (
              <div key={note.id} className="text-sm border-b pb-2 mb-2 last:border-b-0">
                <p>{note.content}</p>
                <p className="text-xs text-muted-foreground mt-1">{formatDateTime(note.createdAt, locale)}</p>
              </div>
            ))}
            <div className="flex gap-2 mt-3">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('orders.notePlaceholder')} className="flex-1" />
              <Button size="sm" onClick={() => noteMutation.mutate()} disabled={!notes.trim() || noteMutation.isPending}>
                {noteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t('orders.addNote')}
              </Button>
            </div>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="space-y-6">
          {/* Shipping */}
          {order.shipment ? (
            <div className="bg-background border rounded-xl p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2"><Truck className="h-4 w-4" />{t('orders.shipment')}</h3>
              <p className="text-sm">Tracking: <span className="font-mono">{order.shipment.trackingNumber ?? '—'}</span></p>
              {order.shipment.trackingUrl && (
                <a href={order.shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary flex items-center gap-1 mt-1 hover:underline">
                  {t('orders.dhlTracking')} <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {order.shipment.labelUrl && (
                <a href={order.shipment.labelUrl} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="mt-2 gap-1.5 w-full">
                    <Download className="h-3.5 w-3.5" />{t('orders.downloadLabel')}
                  </Button>
                </a>
              )}
            </div>
          ) : ['confirmed', 'processing', 'pending'].includes(order.status) ? (
            <div className="bg-background border border-primary/20 rounded-xl p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2"><Truck className="h-4 w-4" />{t('orders.shipment')}</h3>
              <Button
                size="sm"
                className="w-full gap-1.5"
                onClick={async () => {
                  try {
                    await api.post('/shipments', { orderId: order.id, carrier: 'dhl' })
                    queryClient.invalidateQueries({ queryKey: ['admin-order', id] })
                  } catch {}
                }}
              >
                <Truck className="h-3.5 w-3.5" />Versandlabel erstellen (DHL)
              </Button>
            </div>
          ) : null}

          {/* Print */}
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-1.5"
            onClick={() => window.open(`/${locale}/admin/orders/${id}/print`, '_blank')}
          >
            {t('orders.printSlip')}
          </Button>

          {/* Status Change */}
          <div className="bg-background border rounded-xl p-5">
            <h3 className="font-semibold mb-3">{t('orders.changeStatus')}</h3>
            <select value={statusChange} onChange={(e) => setStatusChange(e.target.value)} className="w-full h-9 px-3 rounded-lg border bg-background text-sm mb-2">
              <option value="">{t('orders.selectStatus')}</option>
              <option value="confirmed">{t('status.confirmed')}</option>
              <option value="processing">{t('status.processing')}</option>
              <option value="shipped">{t('status.shipped')}</option>
              <option value="delivered">{t('status.delivered')}</option>
            </select>
            <Input value={statusNotes} onChange={(e) => setStatusNotes(e.target.value)} placeholder={t('orders.reasonPlaceholder')} className="mb-2" />
            <Button size="sm" className="w-full" disabled={!statusChange || statusMutation.isPending} onClick={() => statusMutation.mutate()}>
              {statusMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {t('orders.changeStatusBtn')}
            </Button>
          </div>

          {/* Cancel */}
          {!['cancelled', 'refunded'].includes(order.status) && (
            <div className="bg-background border border-destructive/20 rounded-xl p-5">
              <h3 className="font-semibold mb-3 text-destructive flex items-center gap-2"><Ban className="h-4 w-4" />{t('orders.cancelRefund')}</h3>
              <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder={t('orders.cancelReasonPlaceholder')} className="mb-2" />
              <Button variant="destructive" size="sm" className="w-full" disabled={!cancelReason || cancelMutation.isPending} onClick={() => cancelMutation.mutate()}>
                {cancelMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                {t('orders.cancelBtn')}
              </Button>
            </div>
          )}

          {/* Payment Info */}
          {order.payment && (
            <div className="bg-background border rounded-xl p-5">
              <h3 className="font-semibold mb-3">{t('orders.paymentInfo')}</h3>
              <div className="text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">{t('orders.provider')}</span><span>{order.payment.provider}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{t('orders.method')}</span><span>{order.payment.method}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{t('orders.status')}</span><span className="font-medium">{order.payment.status}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">ID</span><span className="font-mono text-xs">{order.payment.providerPaymentId}</span></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
