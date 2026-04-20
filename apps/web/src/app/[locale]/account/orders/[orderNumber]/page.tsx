'use client'

import { API_BASE_URL } from '@/lib/env'
import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { useQuery } from '@tanstack/react-query'
import { Truck, Check, Download, RotateCcw, ShoppingBag, ExternalLink, CreditCard, ClipboardCheck, Package, Home } from 'lucide-react'
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
  // Hide return button if ANY return exists for this order — whether
  // active, rejected, or refunded. A rejected return means the admin
  // already reviewed and decided. Customer can contact support if needed.
  const hasAnyReturn = (order.returns ?? []).length > 0
  const canReturn = returnsEnabled && order.status === 'delivered' && deliveredAt && daysLeft > 0 && !hasAnyReturn

  const handleReorder = () => {
    for (const item of order.items ?? []) {
      addCartItem({
        variantId: item.variantId,
        productId: item.variant?.product?.id ?? '',
        // Slug MUST come along so the cart-drawer can render the product
        // name + image as a navigable link. Without it the drawer falls
        // back to a static <p> tag and the customer cannot click through
        // to the PDP — which is exactly the "unklickbar" bug the user
        // hit after wieder-bestellen on a past order.
        slug: item.variant?.product?.slug,
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

      {/* Status Timeline — Zalando-Style with icons, animated lines */}
      {!['cancelled', 'refunded', 'disputed'].includes(order.status) && (() => {
        const steps = [
          { key: 'pending', icon: ShoppingBag, label: t('status_pending') },
          { key: 'confirmed', icon: ClipboardCheck, label: t('status_confirmed') },
          { key: 'processing', icon: Package, label: t('status_processing') },
          { key: 'shipped', icon: Truck, label: t('status_shipped') },
          { key: 'delivered', icon: Home, label: t('status_delivered') },
        ]
        return (
          <div className="mb-10 max-w-xl mx-auto">
            <style>{`
              @keyframes tl-fill { from { width: 0 } to { width: 100% } }
              @keyframes tl-pop { 0% { transform: scale(0.5); opacity: 0 } 60% { transform: scale(1.15) } 100% { transform: scale(1); opacity: 1 } }
              @keyframes tl-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(212,168,83,0.4) } 50% { box-shadow: 0 0 0 8px rgba(212,168,83,0) } }
              .tl-step { animation: tl-pop 400ms ease-out both }
              .tl-current { animation: tl-pulse 2s ease-in-out infinite }
              .tl-line-done { position: relative; overflow: hidden }
              .tl-line-done::after { content: ''; position: absolute; inset: 0; background: #d4a853; animation: tl-fill 600ms ease-out both }
            `}</style>
            <div className="flex items-start justify-between">
              {steps.map((step, i) => {
                // When the order reached the terminal 'delivered' step, show
                // it as completed (checkmark) — not as "current" with a
                // pulsing ring. There's no further step to progress to.
                const isTerminalComplete =
                  order.status === 'delivered' && i === steps.length - 1
                const isCompleted = i < currentStepIndex || isTerminalComplete
                const isCurrent = i === currentStepIndex && !isTerminalComplete
                const Icon = step.icon
                const delay = i * 150
                return (
                  <div key={step.key} className="flex items-center flex-1 last:flex-none">
                    <div className="flex flex-col items-center relative z-10">
                      <div
                        className={`tl-step h-11 w-11 rounded-full flex items-center justify-center ${
                          isCompleted ? 'bg-[#d4a853] text-white shadow-md' : isCurrent ? 'tl-current bg-white text-[#d4a853] ring-2 ring-[#d4a853] shadow-sm' : 'bg-[#f5f5f5] text-muted-foreground/30'
                        }`}
                        style={{ animationDelay: `${delay}ms` }}
                      >
                        {isCompleted ? <Check className="h-5 w-5" strokeWidth={2.5} /> : <Icon className="h-5 w-5" />}
                      </div>
                      <span
                        className={`tl-step text-xs mt-2.5 text-center font-medium leading-tight max-w-[72px] ${isCurrent ? 'text-[#d4a853] font-semibold' : isCompleted ? 'text-[#0f1419]' : 'text-muted-foreground/40'}`}
                        style={{ animationDelay: `${delay + 100}ms` }}
                      >{step.label}</span>
                    </div>
                    {i < steps.length - 1 && (
                      <div className="flex-1 mx-1.5 mt-[-16px] h-[2px] relative">
                        {isCompleted ? (
                          <div className="tl-line-done h-full w-full bg-muted/30 rounded-full" style={{ animationDelay: `${delay + 200}ms` }}>
                            <div className="h-full bg-[#d4a853] rounded-full" style={{ animation: `tl-fill 500ms ease-out ${delay + 200}ms both` }} />
                          </div>
                        ) : (
                          <div className="h-full w-full border-t-2 border-dashed border-muted-foreground/15 mt-[-1px]" />
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

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
          <div dir="ltr" className="text-start">
            <p className="text-sm">{order.shippingAddress.firstName} {order.shippingAddress.lastName}</p>
            <p className="text-sm text-muted-foreground">{order.shippingAddress.street} {order.shippingAddress.houseNumber}</p>
            <p className="text-sm text-muted-foreground">{order.shippingAddress.postalCode} {order.shippingAddress.city}, {order.shippingAddress.country}</p>
          </div>
        </div>
      )}

      {/* Return Status Section */}
      {order.returns?.length > 0 && (() => {
        const ret = order.returns[0]
        const returnItems = (ret.returnItems ?? []) as any[]
        const retStatus = ret.status as string
        const retAmt = Number(ret.refundAmount ?? 0) > 0
          ? Number(ret.refundAmount)
          : returnItems.reduce((s: number, ri: any) => s + (Number(ri.unitPrice) || 0) * (ri.quantity || 1), 0)

        const statusLabels: Record<string, { de: string; en: string; ar: string }> = {
          requested:  { de: 'Retoure angefragt',     en: 'Return requested',   ar: 'تم طلب الإرجاع' },
          label_sent: { de: 'Rücksendeetikett gesendet', en: 'Return label sent', ar: 'تم إرسال ملصق الإرجاع' },
          in_transit: { de: 'Rücksendung unterwegs',  en: 'Return in transit',  ar: 'الإرجاع في الطريق' },
          received:   { de: 'Rücksendung eingegangen', en: 'Return received',  ar: 'تم استلام الإرجاع' },
          inspected:  { de: 'Rücksendung geprüft',    en: 'Return inspected',   ar: 'تم فحص الإرجاع' },
          refunded:   { de: 'Erstattung abgeschlossen', en: 'Refund completed', ar: 'تم الاسترداد' },
          rejected:   { de: 'Retoure abgelehnt',      en: 'Return rejected',    ar: 'تم رفض الإرجاع' },
        }
        const statusColors: Record<string, string> = {
          requested: 'border-yellow-300 bg-yellow-50 text-yellow-800',
          label_sent: 'border-blue-300 bg-blue-50 text-blue-800',
          in_transit: 'border-purple-300 bg-purple-50 text-purple-800',
          received: 'border-orange-300 bg-orange-50 text-orange-800',
          inspected: 'border-cyan-300 bg-cyan-50 text-cyan-800',
          refunded: 'border-green-300 bg-green-50 text-green-800',
          rejected: 'border-red-300 bg-red-50 text-red-800',
        }
        const lbl = statusLabels[retStatus] ?? { de: retStatus, en: retStatus, ar: retStatus }
        const clr = statusColors[retStatus] ?? 'border-gray-300 bg-gray-50 text-gray-800'

        return (
          <div className={`border rounded-xl p-5 mb-6 ${clr}`}>
            <div className="flex items-center gap-3 mb-2">
              <RotateCcw className="h-5 w-5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-base">
                  {locale === 'ar' ? lbl.ar : locale === 'en' ? lbl.en : lbl.de}
                </p>
                {ret.returnNumber && (
                  <p className="text-sm opacity-70 mt-0.5" dir="ltr">{ret.returnNumber}</p>
                )}
              </div>
            </div>
            {retStatus === 'requested' ? (
              <p className="text-sm mt-3 opacity-70">
                {locale === 'ar' ? 'يتم مراجعة طلب الإرجاع.'
                  : locale === 'en' ? 'Your return request is being reviewed.'
                    : 'Ihre Retouranfrage wird geprüft.'}
              </p>
            ) : (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm mt-3">
              <span>
                {locale === 'ar' ? 'عدد المنتجات' : locale === 'en' ? 'Items' : 'Artikel'}:{' '}
                <strong>{returnItems.length > 0 ? returnItems.length : (order.items?.length ?? 0)}</strong>
              </span>
              {retAmt > 0 && (
                <span>
                  {locale === 'ar' ? 'مبلغ الاسترداد' : locale === 'en' ? 'Refund amount' : 'Erstattungsbetrag'}:{' '}
                  <strong>&euro;{retAmt.toFixed(2)}</strong>
                </span>
              )}
              {retStatus === 'refunded' && ret.refundedAt && (
                <span>
                  {locale === 'ar' ? 'تاريخ الاسترداد' : locale === 'en' ? 'Refunded on' : 'Erstattet am'}:{' '}
                  <strong>{new Date(ret.refundedAt).toLocaleDateString(locale === 'ar' ? 'ar-EG-u-nu-latn' : locale === 'en' ? 'en-GB' : 'de-DE')}</strong>
                </span>
              )}
            </div>
            )}

            {/* Instructions + Label Download — only after admin decided */}
            {(retStatus === 'in_transit' || retStatus === 'label_sent') && ret.adminNotes && (() => {
              const shopPays = ret.adminNotes === 'shop_pays_shipping'
              return (
                <div className="mt-4 space-y-3">
                  {shopPays ? (
                    <p className="text-sm leading-relaxed">
                      {locale === 'ar'
                        ? 'تم إنشاء ملصق الشحن المجاني. قم بتنزيله وطباعته والصقه على الطرد. يرجى أيضاً إرفاق ملصق الإرجاع داخل الطرد أو كتابة رقم المرتجع على ورقة وإرفاقها.'
                        : locale === 'en'
                          ? 'A free return shipping label has been created. Download, print, and attach it to the package. Please also include the return label inside the package or write the return number on a note.'
                          : 'Ein kostenloses Rücksendeetikett wurde erstellt. Herunterladen, ausdrucken und auf das Paket kleben. Bitte legen Sie auch das Retourenetikett dem Paket bei oder schreiben Sie die Retourennummer auf einen Zettel.'}
                    </p>
                  ) : (
                    <>
                    <p className="text-sm leading-relaxed">
                      {locale === 'ar'
                        ? 'يرجى إرسال المرتجع إلى العنوان التالي. قم بتنزيل ملصق الإرجاع وإرفاقه بالطرد، أو اكتب رقم المرتجع على ورقة وأرفقها.'
                        : locale === 'en'
                          ? 'Please send the return to the following address. Download the return label and include it in the package, or write the return number on a note and include it.'
                          : 'Bitte senden Sie die Retoure an folgende Adresse. Laden Sie das Retourenetikett herunter und legen Sie es dem Paket bei, oder schreiben Sie die Retourennummer auf einen Zettel und legen diesen bei.'}
                    </p>
                    <div className="text-sm font-medium mt-2 px-3 py-2 bg-white/60 rounded-lg border border-current/10" dir="ltr">
                      <p>Malak Bekleidung</p>
                      <p>Pannierstr. 4</p>
                      <p>12047 Berlin, Deutschland</p>
                    </div>
                    </>
                  )}
                  {(() => {
                    const downloadLabel = async (type: 'dhl' | 'internal', filename: string) => {
                      try {
                        const apiUrl = API_BASE_URL
                        const token = useAuthStore.getState().accessToken
                        const res = await fetch(`${apiUrl}/api/v1/users/me/orders/${order.id}/return-label?type=${type}`, {
                          headers: token ? { Authorization: `Bearer ${token}` } : {},
                          credentials: 'include',
                        })
                        if (!res.ok) throw new Error('Download failed')
                        const blob = await res.blob()
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = filename
                        document.body.appendChild(a)
                        a.click()
                        a.remove()
                        URL.revokeObjectURL(url)
                      } catch { /* ignore */ }
                    }
                    const qrData = ret.returnLabelUrl?.startsWith('qr:') ? ret.returnLabelUrl.slice(3) : null
                    return shopPays ? (
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadLabel('dhl', `DHL-Ruecksendeetikett-${ret.returnNumber ?? 'return'}.pdf`)}>
                            <Download className="h-4 w-4" />
                            {locale === 'ar' ? 'تنزيل ملصق الشحن المجاني' : locale === 'en' ? 'Download Free Shipping Label' : 'Kostenloses Versandlabel herunterladen'}
                          </Button>
                          <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadLabel('internal', `Retourenetikett-${ret.returnNumber ?? 'return'}.pdf`)}>
                            <Download className="h-4 w-4" />
                            {locale === 'ar' ? 'تنزيل ملصق الإرجاع' : locale === 'en' ? 'Download Return Label' : 'Retourenetikett herunterladen'}
                          </Button>
                        </div>
                        {qrData && (
                          <div className="border rounded-xl p-4 bg-white text-center">
                            <p className="text-sm font-medium mb-3 text-foreground">
                              {locale === 'ar' ? 'لا يوجد طابعة؟ أظهر هذا الرمز في أي فرع DHL' : locale === 'en' ? 'No printer? Show this QR code at any DHL location' : 'Kein Drucker? Zeigen Sie diesen QR-Code in jeder DHL-Filiale'}
                            </p>
                            <img src={`data:image/png;base64,${qrData}`} alt="DHL Mobile Retoure QR" className="mx-auto w-48 h-48" />
                            <p className="text-xs text-muted-foreground mt-2">
                              {locale === 'ar' ? 'سيتم طباعة ملصق الشحن في الفرع مجاناً' : locale === 'en' ? 'The shipping label will be printed at the location for free' : 'Das Versandlabel wird in der Filiale kostenlos gedruckt'}
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadLabel('internal', `Retourenetikett-${ret.returnNumber ?? 'return'}.pdf`)}>
                        <Download className="h-4 w-4" />
                        {locale === 'ar' ? 'تنزيل ملصق الإرجاع' : locale === 'en' ? 'Download Return Label' : 'Retourenetikett herunterladen'}
                      </Button>
                    )
                  })()}
                </div>
              )
            })()}
          </div>
        )
      })()}

      {/* Items */}
      {(() => {
        // Only consider non-rejected returns — a rejected return should
        // not mark items as "returned" or show strike-through styling.
        const activeReturns = (order.returns ?? []).filter((r: any) => r.status !== 'rejected')
        const ret0 = activeReturns[0]
        const returnItems = (ret0?.returnItems ?? []) as any[]
        const returnedVariantMap = new Map(returnItems.map((ri: any) => [ri.variantId, ri.quantity ?? 1]))
        const hasReturn = activeReturns.length > 0
        // Full cancellation: returnItems is empty but return exists → all items are returned
        const isFullReturn = hasReturn && returnItems.length === 0
        return (
      <div className="border rounded-lg divide-y mb-6">
        {(order.items ?? []).map((item: any) => {
          const returnedQty = isFullReturn ? item.quantity : (returnedVariantMap.get(item.variantId) ?? 0)
          const isReturned = hasReturn && (isFullReturn || returnedQty > 0)
          const isPartial = isReturned && !isFullReturn && returnedQty < item.quantity
          return (
          <div key={item.id} className={`flex gap-4 p-4 ${isReturned ? 'bg-muted/30' : ''}`}>
            {(() => {
              const images = item.variant?.product?.images ?? []
              const color = item.variant?.color
              const colorImg = color ? images.find((img: any) => img.colorName?.toLowerCase() === color.toLowerCase()) : null
              const primaryImg = images.find((img: any) => img.isPrimary)
              const imgUrl = colorImg?.url ?? primaryImg?.url ?? images[0]?.url
              return (
            <div className={`w-16 h-16 bg-muted rounded overflow-hidden flex-shrink-0 ${isReturned && !isPartial ? 'opacity-50' : ''}`}>
              {imgUrl && (
                <Image src={imgUrl} alt={item.snapshotName} width={64} height={64} className="w-full h-full object-cover" />
              )}
            </div>
              )
            })()}
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${isReturned && !isPartial ? 'line-through opacity-60' : ''}`}>{item.snapshotName}</p>
              <p className="text-sm text-muted-foreground">{item.variant?.color}{item.variant?.size ? ` / ${item.variant.size}` : ''} × {item.quantity}</p>
              {isReturned && (
                <span className={`inline-flex items-center gap-1 mt-1 text-xs px-2 py-0.5 rounded-full ${isFullReturn ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                  <RotateCcw className="h-3 w-3" />
                  {isPartial
                    ? (locale === 'ar' ? `${returnedQty} من ${item.quantity} مرتجع` : locale === 'en' ? `${returnedQty} of ${item.quantity} returned` : `${returnedQty} von ${item.quantity} retourniert`)
                    : isFullReturn
                      ? (locale === 'ar' ? 'تم الإلغاء' : locale === 'en' ? 'Cancelled' : 'Storniert')
                      : (locale === 'ar' ? 'مرتجع' : locale === 'en' ? 'Returned' : 'Retourniert')}
                </span>
              )}
            </div>
            <p className={`text-sm font-semibold ${isReturned && !isPartial ? 'line-through opacity-60' : ''}`}>&euro;{Number(item.totalPrice).toFixed(2)}</p>
          </div>
          )
        })}
      </div>
        )
      })()}

      {/* Totals */}
      {(() => {
        const ret = order.returns?.[0]
        const returnItems = (ret?.returnItems ?? []) as any[]
        const refundAmt = ret
          ? (Number(ret.refundAmount ?? 0) > 0
            ? Number(ret.refundAmount)
            : returnItems.reduce((s: number, ri: any) => s + (Number(ri.unitPrice) || 0) * (ri.quantity || 1), 0))
          : 0
        const isRefunded = ret?.status === 'refunded' && refundAmt > 0
        return (
      <div className="border rounded-lg p-5 mb-6 space-y-2 text-base">
        <div className="flex justify-between"><span className="text-muted-foreground">{tCart('subtotal')}</span><span>&euro;{Number(order.subtotal).toFixed(2)}</span></div>
        {Number(order.discountAmount) > 0 && (
          <div className="flex justify-between text-green-600">
            <span className="flex items-center gap-1.5">
              {locale === 'ar' ? 'خصم' : locale === 'en' ? 'Discount' : 'Rabatt'}
              {order.couponCode && <span className="text-[11px] font-mono bg-green-50 text-green-700 px-1.5 py-0.5 rounded" dir="ltr">{order.couponCode}</span>}
            </span>
            <span>- &euro;{Number(order.discountAmount).toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between"><span className="text-muted-foreground">{tCart('shipping')}</span><span>&euro;{Number(order.shippingCost).toFixed(2)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">{tCart('tax')}</span><span>&euro;{Number(order.taxAmount).toFixed(2)}</span></div>
        <div className="flex justify-between font-bold text-base pt-2 border-t"><span>{tCart('total')}</span><span>&euro;{Number(order.totalAmount).toFixed(2)}</span></div>
        {isRefunded && (
          <div className="flex justify-between text-green-600 font-semibold pt-2 border-t border-green-200">
            <span>{locale === 'ar' ? 'الاسترداد' : locale === 'en' ? 'Refund' : 'Erstattung'}</span>
            <span>- &euro;{refundAmt.toFixed(2)}</span>
          </div>
        )}
      </div>
        )
      })()}

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        {/* Retry Payment for pending orders */}
        {['pending', 'pending_payment'].includes(order.status) && (
          <Button size="sm" className="gap-2 bg-[#d4a853] text-white hover:bg-[#c49b45]"
            onClick={() => router.push(`/${locale}/account/orders/${orderNumber}/retry-payment`)}>
            <CreditCard className="h-4 w-4" />
            {locale === 'ar' ? 'إعادة الدفع' : locale === 'en' ? 'Retry Payment' : 'Erneut bezahlen'}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={handleReorder} className="gap-2">
          <ShoppingBag className="h-4 w-4" />
          {t('reorder')}
        </Button>
        {/* Invoice: only show for paid orders (payment captured/refunded) */}
        {['captured', 'refunded', 'partially_refunded'].includes(order.payment?.status) && (
          <Button variant="outline" size="sm" className="gap-2" onClick={async () => {
            try {
              const apiUrl = API_BASE_URL
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
        )}
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
