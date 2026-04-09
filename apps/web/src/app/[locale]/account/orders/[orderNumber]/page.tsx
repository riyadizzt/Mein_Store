'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { useQuery } from '@tanstack/react-query'
import { Truck, Check, Download, RotateCcw, ShoppingBag, ExternalLink } from 'lucide-react'
import { api } from '@/lib/api'
import { useCartStore } from '@/store/cart-store'
import { useAuthStore } from '@/store/auth-store'
import { Button } from '@/components/ui/button'
import { ReturnRequestModal } from '@/components/account/return-request-modal'

const TIMELINE_STEPS = ['pending', 'confirmed', 'processing', 'shipped', 'delivered']

export default function OrderDetailPage({ params: { orderNumber } }: { params: { orderNumber: string; locale: string } }) {
  const t = useTranslations('account.orders')
  const tCart = useTranslations('cart')
  const tErrors = useTranslations('errors')
  const locale = useLocale()
  const router = useRouter()
  const addCartItem = useCartStore((s) => s.addItem)
  const [returnModalOpen, setReturnModalOpen] = useState(false)

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
  // deliveredAt: Shipment-Datum oder Fallback auf updatedAt wenn Status=delivered
  const deliveredAt = order.shipment?.deliveredAt
    ? new Date(order.shipment.deliveredAt)
    : order.status === 'delivered' && order.updatedAt
      ? new Date(order.updatedAt)
      : null
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
              <span key={step} className="text-xs text-muted-foreground w-8 text-center">{t(`status_${step}`)}</span>
            ))}
          </div>
        </div>
      )}

      {/* Tracking / Shipping Status */}
      {(order.status === 'shipped' || order.status === 'delivered' || order.shipment?.trackingNumber) && (
        <div className="border rounded-xl p-5 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <Truck className="h-5 w-5 text-[#d4a853]" />
            <p className="text-base font-semibold">
              {order.status === 'delivered'
                ? (locale === 'ar' ? 'تم التسليم' : locale === 'en' ? 'Delivered' : 'Zugestellt')
                : (locale === 'ar' ? 'تم الشحن' : locale === 'en' ? 'Shipped' : 'Versendet')}
            </p>
          </div>
          {order.shipment?.trackingNumber ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{locale === 'ar' ? 'رقم التتبع' : 'Sendungsnummer'}</p>
                <p className="text-base font-mono font-medium mt-0.5" dir="ltr">{order.shipment.trackingNumber}</p>
                {order.shipment.carrier && <p className="text-sm text-muted-foreground mt-0.5">{order.shipment.carrier}</p>}
              </div>
              {order.shipment.trackingUrl && (
                <a href={order.shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-[#d4a853] text-sm flex items-center gap-1 hover:underline">
                  {t('tracking')} <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {locale === 'ar' ? 'تم شحن طلبك. ستتلقى رقم التتبع قريباً عبر البريد الإلكتروني.' : locale === 'en' ? 'Your order has been shipped. You will receive the tracking number soon by email.' : 'Deine Bestellung wurde versendet. Du erhältst die Sendungsnummer in Kürze per E-Mail.'}
            </p>
          )}
        </div>
      )}

      {/* Shipping Address */}
      {order.shippingAddress && (
        <div className="border rounded-lg p-4 mb-6">
          <p className="text-sm font-medium text-muted-foreground mb-1">{t('shippingAddress')}</p>
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
              <p className="text-sm text-muted-foreground">{item.variant?.color}{item.variant?.size ? ` / ${item.variant.size}` : ''} × {item.quantity}</p>
            </div>
            <p className="text-sm font-semibold">&euro;{Number(item.totalPrice).toFixed(2)}</p>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="border rounded-lg p-5 mb-6 space-y-2 text-base">
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
      <ReturnRequestModal
        open={returnModalOpen}
        onClose={() => setReturnModalOpen(false)}
        orderId={order.id}
        orderNumber={orderNumber}
        daysLeft={daysLeft}
        deliveryDeadline={deliveredAt ? new Date(deliveredAt.getTime() + 14 * 86400000).toLocaleDateString(locale === 'ar' ? 'ar-EG-u-nu-latn' : locale === 'en' ? 'en-GB' : 'de-DE') : '—'}
        items={(order.items ?? []).map((item: any) => ({
          id: item.id,
          variantId: item.variantId,
          name: item.snapshotName,
          color: item.variant?.color,
          size: item.variant?.size,
          quantity: item.quantity,
          imageUrl: item.variant?.product?.images?.[0]?.url,
          unitPrice: Number(item.unitPrice),
          excludeFromReturns: item.variant?.product?.excludeFromReturns ?? false,
          returnExclusionReason: item.variant?.product?.returnExclusionReason,
        }))}
      />
    </div>
  )
}
