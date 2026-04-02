'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Truck, Check, Download, RotateCcw, ShoppingBag, ExternalLink, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useCartStore } from '@/store/cart-store'
import { useAuthStore } from '@/store/auth-store'
import { Button } from '@/components/ui/button'

const TIMELINE_STEPS = ['pending', 'confirmed', 'processing', 'shipped', 'delivered']

export default function OrderDetailPage({ params: { orderNumber } }: { params: { orderNumber: string; locale: string } }) {
  const t = useTranslations('account.orders')
  const tReturn = useTranslations('return')
  const tReasons = useTranslations('account.returnReasons')
  const tCart = useTranslations('cart')
  const tErrors = useTranslations('errors')
  const locale = useLocale()
  const router = useRouter()
  const queryClient = useQueryClient()
  const addCartItem = useCartStore((s) => s.addItem)
  const [returnModalOpen, setReturnModalOpen] = useState(false)
  const [returnReason, setReturnReason] = useState('wrong_size')
  const [returnNotes, setReturnNotes] = useState('')

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  const { data: order, isLoading } = useQuery({
    queryKey: ['order', orderNumber],
    queryFn: async () => {
      // Step 1: Fetch order list to find UUID by orderNumber
      const { data: listData } = await api.get('/users/me/orders', { params: { limit: 50 } })
      const orders = listData?.items ?? listData?.data ?? (Array.isArray(listData) ? listData : [])
      const found = orders.find((o: any) => o.orderNumber === orderNumber)
      if (!found) return null

      // Step 2: Fetch full detail by UUID
      const { data: detail } = await api.get(`/users/me/orders/${found.id}`)
      return detail ?? found
    },
    enabled: isAuthenticated,
    retry: 2,
    staleTime: 30000,
  })

  const returnMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/orders/${order.id}/return-request`, {
        reason: returnReason,
        notes: returnNotes || undefined,
      })
    },
    onSuccess: () => {
      setReturnModalOpen(false)
      queryClient.invalidateQueries({ queryKey: ['order', orderNumber] })
    },
  })

  // Check if returns are enabled globally — MUST be before any early returns
  const { data: shopSettings } = useQuery({
    queryKey: ['public-settings-returns'],
    queryFn: async () => { const { data } = await api.get('/settings/public'); return data },
    staleTime: 60000,
  })

  if (isLoading) {
    return <div className="space-y-4">{[1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse bg-muted rounded-lg" />)}</div>
  }

  if (!order) {
    return <p className="text-muted-foreground">{tErrors('notFound')}</p>
  }

  const currentStepIndex = TIMELINE_STEPS.indexOf(order.status)
  const deliveredAt = order.shipment?.deliveredAt ? new Date(order.shipment.deliveredAt) : null
  const returnsEnabled = shopSettings?.returnsEnabled !== false && shopSettings?.returnsEnabled !== 'false'
  const daysLeft = deliveredAt ? Math.max(0, 14 - Math.floor((Date.now() - deliveredAt.getTime()) / 86400000)) : 0
  const canReturn = returnsEnabled && order.status === 'delivered' && deliveredAt && daysLeft > 0

  const handleReorder = () => {
    for (const item of order.items ?? []) {
      addCartItem({
        variantId: item.variantId,
        productId: item.variant?.product?.id ?? '',
        name: item.snapshotName,
        sku: item.snapshotSku ?? item.variant?.sku ?? '',
        color: item.variant?.color,
        size: item.variant?.size,
        imageUrl: item.variant?.product?.images?.[0]?.url,
        unitPrice: Number(item.unitPrice),
        quantity: item.quantity,
      })
    }
    router.push(`/${locale}/checkout`)
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-6">{t('detail', { number: orderNumber })}</h2>

      {/* Status Timeline */}
      {!['cancelled', 'refunded', 'disputed'].includes(order.status) && (
        <div className="mb-8 max-w-lg">
          <div className="flex items-center justify-between">
            {TIMELINE_STEPS.map((step, i) => (
              <div key={step} className="flex items-center flex-1 last:flex-none">
                <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
                  i <= currentStepIndex
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {i < currentStepIndex ? <Check className="h-4 w-4" /> : i + 1}
                </div>
                {i < TIMELINE_STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-1 ${i < currentStepIndex ? 'bg-primary' : 'bg-muted'}`} />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-1.5 max-w-lg">
            {TIMELINE_STEPS.map((step) => (
              <span key={step} className="text-[10px] text-muted-foreground w-8 text-center">{t(`status_${step}`)}</span>
            ))}
          </div>
        </div>
      )}

      {/* Tracking */}
      {order.shipment?.trackingNumber && (
        <div className="border rounded-lg p-4 mb-6 flex items-center gap-3">
          <Truck className="h-5 w-5 text-primary" />
          <div className="flex-1">
            <p className="text-sm font-medium">Tracking: {order.shipment.trackingNumber}</p>
          </div>
          {order.shipment.trackingUrl && (
            <a href={order.shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-primary text-sm flex items-center gap-1 hover:underline">
              {t('tracking')} <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}

      {/* Shipping Address */}
      {order.shippingAddress && (
        <div className="border rounded-lg p-4 mb-6">
          <p className="text-xs font-medium text-muted-foreground mb-1">{t('shippingAddress')}</p>
          <p className="text-sm">{order.shippingAddress.firstName} {order.shippingAddress.lastName}</p>
          <p className="text-sm text-muted-foreground">{order.shippingAddress.street} {order.shippingAddress.houseNumber}</p>
          <p className="text-sm text-muted-foreground">{order.shippingAddress.postalCode} {order.shippingAddress.city}, {order.shippingAddress.country}</p>
        </div>
      )}

      {/* Items */}
      <div className="border rounded-lg divide-y mb-6">
        {(order.items ?? []).map((item: any) => (
          <div key={item.id} className="flex gap-4 p-4">
            <div className="w-16 h-16 bg-muted rounded overflow-hidden flex-shrink-0">
              {item.variant?.product?.images?.[0]?.url && (
                <Image src={item.variant.product.images[0].url} alt={item.snapshotName} width={64} height={64} className="w-full h-full object-cover" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{item.snapshotName}</p>
              <p className="text-xs text-muted-foreground">{item.variant?.color}{item.variant?.size ? ` / ${item.variant.size}` : ''} × {item.quantity}</p>
            </div>
            <p className="text-sm font-semibold">&euro;{Number(item.totalPrice).toFixed(2)}</p>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="border rounded-lg p-4 mb-6 space-y-1.5 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">{tCart('subtotal')}</span><span>&euro;{Number(order.subtotal).toFixed(2)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">{tCart('shipping')}</span><span>&euro;{Number(order.shippingCost).toFixed(2)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">{tCart('tax')}</span><span>&euro;{Number(order.taxAmount).toFixed(2)}</span></div>
        <div className="flex justify-between font-bold text-base pt-2 border-t"><span>{tCart('total')}</span><span>&euro;{Number(order.totalAmount).toFixed(2)}</span></div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" size="sm" onClick={handleReorder} className="gap-2">
          <ShoppingBag className="h-4 w-4" />
          {t('reorder')}
        </Button>
        <Button variant="outline" size="sm" className="gap-2" onClick={async () => {
          try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
            const token = useAuthStore.getState().accessToken
            const res = await fetch(`${apiUrl}/api/v1/payments/orders/${order.id}/invoice`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
              credentials: 'include',
            })
            if (!res.ok) throw new Error('Download failed')
            const blob = await res.blob()
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `invoice-${orderNumber}.pdf`
            document.body.appendChild(a)
            a.click()
            a.remove()
            URL.revokeObjectURL(url)
          } catch { /* ignore */ }
        }}>
          <Download className="h-4 w-4" />
          {t('invoice')}
        </Button>
        {canReturn && (
          <Button variant="outline" size="sm" onClick={() => setReturnModalOpen(true)} className="gap-2 text-destructive border-destructive/30">
            <RotateCcw className="h-4 w-4" />
            {t('returnRequest')}
          </Button>
        )}
      </div>

      {/* Return Modal */}
      {returnModalOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setReturnModalOpen(false)} />
          <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-md mx-auto bg-background rounded-xl p-6 shadow-xl">
            <h3 className="text-lg font-bold mb-4">{tReturn('title')}</h3>
            <p className="text-xs text-muted-foreground mb-4">
              {t('returnDeadline', { date: deliveredAt ? new Date(deliveredAt.getTime() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString('de-DE') : '—' })}
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium mb-1.5 block">{tReturn('reason')}</label>
                <select value={returnReason} onChange={(e) => setReturnReason(e.target.value)} className="w-full h-10 px-3 rounded-lg border bg-background text-sm">
                  <option value="wrong_size">{tReasons('wrong_size')}</option>
                  <option value="wrong_product">{tReasons('wrong_product')}</option>
                  <option value="quality_issue">{tReasons('quality_issue')}</option>
                  <option value="damaged">{tReasons('damaged')}</option>
                  <option value="changed_mind">{tReasons('changed_mind')}</option>
                  <option value="other">{tReasons('other')}</option>
                </select>
              </div>
              {returnReason === 'other' && (
                <textarea
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  placeholder={tReturn('notes')}
                  className="w-full h-20 px-3 py-2 rounded-lg border bg-background text-sm resize-none"
                />
              )}
              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => setReturnModalOpen(false)} className="flex-1">{tReturn('cancel')}</Button>
                <Button onClick={() => returnMutation.mutate()} disabled={returnMutation.isPending} className="flex-1">
                  {returnMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {tReturn('submit')}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
