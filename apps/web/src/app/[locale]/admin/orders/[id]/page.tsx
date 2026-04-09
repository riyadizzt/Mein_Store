'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocale } from 'next-intl'
import Link from 'next/link'
import Image from 'next/image'
import {
  Check, Truck, Download, Ban, Loader2, ExternalLink, StickyNote,
  Package, CreditCard, MapPin, User, Clock, FileText,
  ChevronRight, Printer, RotateCcw, AlertTriangle, Copy, Euro, Building2
} from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth-store'
import { useConfirm } from '@/components/ui/confirm-modal'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/locale-utils'
import { getImageUrl } from '@/lib/imagekit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { ChannelBadge } from '@/components/admin/channel-icon'
import { FulfillmentWarehouseSelect } from '@/components/admin/fulfillment-warehouse-select'
import { RefundStatusBanner } from '@/components/admin/refund-status-banner'

// ── Status Helpers ───────────────────────────────────────────
const STATUS_FLOW = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'] as const
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800', pending_payment: 'bg-orange-100 text-orange-800', confirmed: 'bg-blue-100 text-blue-800',
  processing: 'bg-purple-100 text-purple-800', shipped: 'bg-indigo-100 text-indigo-800',
  delivered: 'bg-green-100 text-green-800', cancelled: 'bg-red-100 text-red-800',
  refunded: 'bg-orange-100 text-orange-800',
}
const NEXT_STATUS: Record<string, string> = {
  pending: 'confirmed', confirmed: 'processing', processing: 'shipped', shipped: 'delivered',
}
const NEXT_BTN_COLORS: Record<string, string> = {
  pending: 'bg-blue-600 hover:bg-blue-700', confirmed: 'bg-purple-600 hover:bg-purple-700',
  processing: 'bg-indigo-600 hover:bg-indigo-700', shipped: 'bg-green-600 hover:bg-green-700',
}
const PROVIDER_COLORS: Record<string, string> = {
  stripe: 'bg-violet-100 text-violet-800', paypal: 'bg-blue-100 text-blue-800',
  klarna: 'bg-pink-100 text-pink-800',
}

export default function AdminOrderDetailPage({ params: { id } }: { params: { id: string; locale: string } }) {
  const locale = useLocale()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const notesRef = useRef<HTMLInputElement>(null)
  const adminUser = useAuthStore((s) => s.adminUser) as any
  const canCancel = adminUser?.role === 'super_admin' || adminUser?.permissions?.includes('orders.cancel')

  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  const [notes, setNotes] = useState('')
  const [statusNotes, setStatusNotes] = useState('')
  const [trackingNumber, setTrackingNumber] = useState('')
  const [trackingCarrier, setTrackingCarrier] = useState('')
  const [partialCancelIds, setPartialCancelIds] = useState<Set<string>>(new Set())
  const [partialCancelReason, setPartialCancelReason] = useState('')
  const [showPartialCancel, setShowPartialCancel] = useState(false)
  const [copied, setCopied] = useState(false)
  const [optimisticStatus, setOptimisticStatus] = useState<string | null>(null)

  // ── Queries ────────────────────────────────────────────────
  const { data: order, isLoading } = useQuery({
    queryKey: ['admin-order', id],
    queryFn: async () => { const { data } = await api.get(`/admin/orders/${id}`); return data },
  })

  // ── Mutations ──────────────────────────────────────────────
  const statusMutation = useMutation({
    mutationFn: (nextStatus: string) => api.patch(`/admin/orders/${id}/status`, { status: nextStatus, notes: statusNotes }),
    onMutate: (nextStatus) => { setOptimisticStatus(nextStatus) },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-order', id] }); setStatusNotes(''); setOptimisticStatus(null) },
    onError: () => { setOptimisticStatus(null) },
  })

  const cancelMutation = useMutation({
    mutationFn: (reason: string) => api.post(`/admin/orders/${id}/cancel`, { reason }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-order', id] }) },
  })

  const partialCancelMutation = useMutation({
    mutationFn: () => api.post(`/admin/orders/${id}/cancel-items`, { itemIds: [...partialCancelIds], reason: partialCancelReason }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-order', id] }); setPartialCancelIds(new Set()); setPartialCancelReason(''); setShowPartialCancel(false) },
  })

  const noteMutation = useMutation({
    mutationFn: () => api.post(`/admin/orders/${id}/notes`, { content: notes }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-order', id] }); setNotes('') },
  })

  // ── Keyboard Shortcuts ─────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return
      if (e.key === 'p') downloadInvoice()
      if (e.key === 'l') downloadDeliveryNote()
      if (e.key === 'n') { e.preventDefault(); notesRef.current?.focus() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [id])

  // ── Downloads ──────────────────────────────────────────────
  const downloadInvoice = useCallback(async () => {
    if (!order?.invoices?.length) return
    const inv = order.invoices.find((i: any) => i.type === 'invoice') ?? order.invoices[0]
    try {
      const token = useAuthStore.getState().adminAccessToken
      const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
      const res = await fetch(`${API}/api/v1/admin/invoices/${inv.id}/download`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a')
      a.href = url; a.download = `${inv.invoiceNumber}.pdf`; a.click(); URL.revokeObjectURL(url)
    } catch { /* silent */ }
  }, [order])

  const downloadDeliveryNote = useCallback(async () => {
    try {
      const token = useAuthStore.getState().adminAccessToken
      const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
      const res = await fetch(`${API}/api/v1/admin/orders/${id}/delivery-note`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a')
      a.href = url; a.download = `lieferschein-${order?.orderNumber ?? id}.pdf`; a.click(); URL.revokeObjectURL(url)
    } catch { /* silent */ }
  }, [id, order])

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  // ── Status Helpers ─────────────────────────────────────────
  const currentStatus = optimisticStatus ?? order?.status
  const statusLabel = (s: string) => {
    const map: Record<string, string> = {
      pending: t3('Ausstehend', 'Pending', 'معلق'),
      pending_payment: t3('Zahlung ausstehend', 'Awaiting Payment', 'بانتظار الدفع'),
      confirmed: t3('Bestätigt', 'Confirmed', 'مؤكد'),
      processing: t3('In Bearbeitung', 'Processing', 'قيد المعالجة'), shipped: t3('Versendet', 'Shipped', 'تم الشحن'),
      delivered: t3('Zugestellt', 'Delivered', 'تم التسليم'), cancelled: t3('Storniert', 'Cancelled', 'ملغى'),
      refunded: t3('Erstattet', 'Refunded', 'مسترد'),
    }
    return map[s] ?? s
  }

  const progressStepLabels = [
    t3('Bestellt', 'Ordered', 'تم الطلب'), t3('Bestätigt', 'Confirmed', 'مؤكد'),
    t3('In Bearbeitung', 'Processing', 'قيد المعالجة'), t3('Versendet', 'Shipped', 'تم الشحن'),
    t3('Zugestellt', 'Delivered', 'تم التسليم'),
  ]

  const nextStatusLabel: Record<string, string> = {
    pending: t3('Bestätigen', 'Confirm', 'تأكيد'), confirmed: t3('In Bearbeitung', 'Start Processing', 'بدء المعالجة'),
    processing: t3('Als versendet markieren', 'Mark as Shipped', 'تحديد كمشحون'),
    shipped: t3('Als zugestellt markieren', 'Mark as Delivered', 'تحديد كمُسلّم'),
  }

  // ── Loading Skeleton ───────────────────────────────────────
  if (isLoading) return (
    <div className="space-y-6">
      <div className="h-8 w-48 animate-pulse bg-muted rounded-lg" />
      <div className="h-32 animate-pulse bg-muted rounded-2xl" />
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 space-y-6">
          {[1, 2, 3].map((i) => <div key={i} className="h-48 animate-pulse bg-muted rounded-2xl" />)}
        </div>
        <div className="w-full lg:w-[380px] space-y-6">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-36 animate-pulse bg-muted rounded-2xl" />)}
        </div>
      </div>
    </div>
  )
  if (!order) return <p className="text-muted-foreground py-12 text-center">{t3('Bestellung nicht gefunden', 'Order not found', 'الطلب غير موجود')}</p>

  const isCancelled = currentStatus === 'cancelled' || currentStatus === 'refunded'
  const currentStepIndex = STATUS_FLOW.indexOf(currentStatus as any)
  const historyMap = new Map<string, string>()
  for (const h of order.statusHistory ?? []) {
    if (h.toStatus && h.createdAt) historyMap.set(h.toStatus, h.createdAt)
  }

  // Merge timeline: status history + admin notes
  const timelineEntries = [
    ...(order.statusHistory ?? []).map((h: any) => ({ type: 'status', date: h.createdAt, from: h.fromStatus, to: h.toStatus, source: h.source, notes: h.notes, by: h.createdBy })),
    ...(order.adminNotes ?? []).map((n: any) => ({ type: 'note', date: n.createdAt, content: n.content, by: n.admin ? `${n.admin.firstName} ${n.admin.lastName}` : '' })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return (
    <div>
      <style>{`
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: translateY(0) } }
      `}</style>

      <AdminBreadcrumb items={[{ label: t3('Bestellungen', 'Orders', 'الطلبات'), href: `/${locale}/admin/orders` }, { label: order.orderNumber }]} />

      {/* ── HEADER ─────────────────────────────────────────── */}
      <div className="bg-[#1a1a2e] text-white rounded-2xl p-6 mb-6" style={{ animation: 'fadeSlideUp 300ms ease-out' }}>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold font-mono tracking-wide">{order.orderNumber}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-white/60">{formatDateTime(order.createdAt, locale)}</span>
              <span className="text-white/30">&middot;</span>
              <ChannelBadge channel={order.channel ?? 'website'} locale={locale} />
            </div>
            <p className="text-sm text-white/80 mt-2">
              {order.user ? `${order.user.firstName} ${order.user.lastName}` : (order.guestEmail ?? t3('Gast', 'Guest', 'ضيف'))}
              {order.user?.email && <span className="text-white/50 ltr:ml-2 rtl:mr-2">{order.user.email}</span>}
            </p>
          </div>
          <span className={`${STATUS_COLORS[currentStatus] ?? 'bg-gray-100 text-gray-800'} rounded-full px-4 py-1.5 text-xs font-semibold self-start`}>
            {statusLabel(currentStatus)}
          </span>
        </div>
      </div>

      {/* ── PROGRESS BAR ───────────────────────────────────── */}
      <div className="bg-background border rounded-2xl p-5 mb-6" style={{ animation: 'fadeSlideUp 300ms ease-out 50ms both' }}>
        <div className="flex items-center justify-between relative">
          {progressStepLabels.map((label, i) => {
            const isCompleted = !isCancelled && currentStepIndex >= i
            const isCurrent = !isCancelled && currentStepIndex === i
            const isCancelledHere = isCancelled && currentStepIndex === i
            const stepStatus = STATUS_FLOW[i] ?? 'pending'
            const stepDate = i === 0 ? order.createdAt : historyMap.get(stepStatus)
            return (
              <div key={i} className="flex flex-col items-center flex-1 relative z-10">
                <div className={`h-9 w-9 rounded-full flex items-center justify-center transition-all duration-500 text-sm font-bold
                  ${isCancelledHere ? 'bg-red-500 text-white' : isCompleted ? (isCurrent ? 'bg-[#d4a853] text-white ring-4 ring-[#d4a853]/20' : 'bg-green-500 text-white') : 'bg-muted text-muted-foreground'}`}>
                  {isCancelledHere ? <Ban className="h-4 w-4" /> : isCompleted && !isCurrent ? <Check className="h-4 w-4" /> : i + 1}
                </div>
                <span className={`text-[11px] mt-2 text-center font-medium transition-colors duration-300 ${isCurrent ? 'text-[#d4a853]' : isCompleted ? 'text-foreground' : 'text-muted-foreground'}`}>{isCancelledHere ? t3('Storniert', 'Cancelled', 'ملغى') : label}</span>
                {stepDate && isCompleted && <span className="text-[10px] text-muted-foreground mt-0.5">{formatDate(stepDate, locale)}</span>}
              </div>
            )
          })}
          {/* Connecting lines */}
          <div className="absolute top-[18px] ltr:left-[10%] rtl:right-[10%] ltr:right-[10%] rtl:left-[10%] h-[2px] bg-muted -z-0" />
          <div className="absolute top-[18px] ltr:left-[10%] rtl:right-[10%] h-[2px] bg-green-500 -z-0 transition-all duration-700"
            style={{ width: `${Math.max(0, Math.min(currentStepIndex, 4)) * 20}%` }} />
        </div>
      </div>

      {/* ── TWO COLUMN LAYOUT ──────────────────────────────── */}
      <div className="flex flex-col lg:flex-row gap-6">

        {/* ── LEFT COLUMN ──────────────────────────────────── */}
        <div className="flex-1 space-y-6">

          {/* Products */}
          {/* Refund Status Banner */}
          <RefundStatusBanner order={order} locale={locale} />

          <div className="bg-background border rounded-2xl p-5 shadow-sm" style={{ animation: 'fadeSlideUp 300ms ease-out 100ms both' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Package className="h-4 w-4" /> {t3('Artikel', 'Items', 'المنتجات')} ({order.items?.length ?? 0})
              </h3>
            </div>
            <div className="divide-y">
              {(order.items ?? []).map((item: any) => {
                const isCancelledItem = item.quantity === 0
                const images = item.variant?.product?.images ?? []
                const colorMatch = item.variant?.color ? images.find((img: any) => img.colorName === item.variant.color) : null
                const primaryImg = images.find((img: any) => img.isPrimary)
                const imgUrl = colorMatch?.url ?? primaryImg?.url ?? images[0]?.url
                const translatedName = item.variant?.product?.translations?.find((t: any) => t.language === locale)?.name ?? item.snapshotName
                return (
                  <div key={item.id} className={`flex gap-4 py-4 ${isCancelledItem ? 'opacity-50' : ''}`}>
                    <div className="w-20 h-20 bg-muted rounded-xl overflow-hidden flex-shrink-0">
                      {imgUrl ? <Image src={getImageUrl(imgUrl, { width: 160, height: 160, fit: 'cover' })} alt="" width={80} height={80} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><Package className="h-6 w-6 text-muted-foreground" /></div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <Link href={`/${locale}/admin/products/${item.variant?.product?.slug ?? ''}`} className={`text-sm font-semibold hover:text-[#d4a853] transition-colors ${isCancelledItem ? 'line-through' : ''}`}>
                            {translatedName}
                          </Link>
                          <div className="flex items-center gap-2 mt-1">
                            {item.variant?.color && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><span className="h-3 w-3 rounded-full border" style={{ backgroundColor: item.variant.color.toLowerCase() }} />{item.variant.color}</span>}
                            {item.variant?.size && <span className="text-[10px] font-semibold bg-muted px-2 py-0.5 rounded-md">{item.variant.size}</span>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 font-mono">{item.snapshotSku}</p>
                        </div>
                        <div className="text-end flex-shrink-0">
                          {isCancelledItem ? (
                            <span className="text-xs bg-red-100 text-red-700 rounded-full px-3 py-1 font-semibold">{t3('Storniert', 'Cancelled', 'ملغى')}</span>
                          ) : (
                            <>
                              <p className="text-sm text-muted-foreground">{item.quantity} &times; {formatCurrency(Number(item.unitPrice), locale)}</p>
                              <p className="text-sm font-bold mt-0.5">{formatCurrency(Number(item.totalPrice), locale)}</p>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Price Summary */}
          <div className="bg-background border rounded-2xl p-5 shadow-sm" style={{ animation: 'fadeSlideUp 300ms ease-out 150ms both' }}>
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2"><Euro className="h-4 w-4" /> {t3('Zusammenfassung', 'Summary', 'الملخص')}</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">{t3('Zwischensumme', 'Subtotal', 'المجموع الفرعي')}</span><span>{formatCurrency(Number(order.subtotal), locale)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t3('Versand', 'Shipping', 'الشحن')}</span><span>{formatCurrency(Number(order.shippingCost), locale)}</span></div>
              {order.couponCode && (
                <div className="flex justify-between"><span className="text-green-600 flex items-center gap-1">{t3('Gutschein', 'Coupon', 'كوبون')} <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-mono">{order.couponCode}</span></span><span className="text-green-600">-{formatCurrency(Number(order.discountAmount), locale)}</span></div>
              )}
              <div className="flex justify-between"><span className="text-muted-foreground">{t3('MwSt. 19%', 'VAT 19%', 'ض.ق.م 19%')}</span><span>{formatCurrency(Number(order.taxAmount), locale)}</span></div>
              <div className="flex justify-between font-bold text-lg pt-3 border-t"><span>{t3('Gesamt', 'Total', 'الإجمالي')}</span><span className="text-[#d4a853]">{formatCurrency(Number(order.totalAmount), locale)}</span></div>
            </div>
          </div>

          {/* Timeline */}
          <div className="bg-background border rounded-2xl p-5 shadow-sm" style={{ animation: 'fadeSlideUp 300ms ease-out 200ms both' }}>
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2"><Clock className="h-4 w-4" /> {t3('Verlauf', 'Timeline', 'السجل')}</h3>
            <div className="relative">
              <div className="absolute ltr:left-[11px] rtl:right-[11px] top-3 bottom-3 w-[2px] bg-muted" />
              <div className="space-y-4">
                {timelineEntries.map((entry, i) => (
                  <div key={i} className="flex items-start gap-3 relative">
                    {entry.type === 'status' ? (
                      <div className={`h-6 w-6 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${entry.to === 'cancelled' ? 'bg-red-500' : entry.to === 'delivered' ? 'bg-green-500' : 'bg-[#d4a853]'}`}>
                        {entry.to === 'cancelled' ? <Ban className="h-3 w-3 text-white" /> : <Check className="h-3 w-3 text-white" />}
                      </div>
                    ) : (
                      <div className="h-6 w-6 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 z-10">
                        <StickyNote className="h-3 w-3 text-amber-700" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0 pb-1">
                      {entry.type === 'status' ? (
                        <>
                          <p className="text-sm font-medium">{statusLabel(entry.from ?? '')} <ChevronRight className="h-3 w-3 inline-block mx-1 text-muted-foreground rtl:rotate-180" /> {statusLabel(entry.to)}</p>
                          {entry.notes && <p className="text-xs text-muted-foreground mt-0.5">{(() => {
                            const n = entry.notes as string
                            const NOTE_MAP: Record<string, { de: string; ar: string }> = {
                              'إلغاء من السيستم': { de: 'Automatisch storniert', ar: 'إلغاء تلقائي من النظام' },
                              'Zahlungstimeout — automatisch storniert': { de: 'Zahlungstimeout — automatisch storniert', ar: 'انتهاء مهلة الدفع — تم الإلغاء تلقائياً' },
                            }
                            for (const [key, val] of Object.entries(NOTE_MAP)) {
                              if (n.includes(key)) return locale === 'ar' ? val.ar : val.de
                            }
                            if (n.startsWith('Bestellung ') && n.includes(' erstellt')) return locale === 'ar' ? n.replace('Bestellung ', 'الطلب ').replace(' erstellt', ' تم إنشاؤه') : n
                            return n
                          })()}</p>}
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-medium">{t3('Notiz', 'Note', 'ملاحظة')}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{entry.content}</p>
                        </>
                      )}
                      <p className="text-[10px] text-muted-foreground mt-1">{formatDateTime(entry.date, locale)}{entry.by ? ` — ${entry.by}` : ''}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN ─────────────────────────────────── */}
        <div className="w-full lg:w-[380px] space-y-5">

          {/* Customer */}
          <div className="bg-background border rounded-2xl p-5 shadow-sm" style={{ animation: 'fadeSlideUp 300ms ease-out 100ms both' }}>
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2"><User className="h-4 w-4" /> {t3('Kunde', 'Customer', 'العميل')}</h3>
            <div className="flex items-center gap-3">
              {order.user?.profileImageUrl ? (
                <Image src={getImageUrl(order.user.profileImageUrl, { width: 80, height: 80 })} alt="" width={40} height={40} className="h-10 w-10 rounded-full object-cover" />
              ) : (
                <div className="h-10 w-10 rounded-full bg-[#d4a853]/10 text-[#d4a853] flex items-center justify-center font-bold text-sm">
                  {(order.user?.firstName?.[0] ?? order.guestEmail?.[0] ?? 'G').toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                {order.user ? (
                  <Link href={`/${locale}/admin/customers/${order.user.id}`} className="text-sm font-semibold hover:text-[#d4a853] transition-colors">
                    {order.user.firstName} {order.user.lastName}
                  </Link>
                ) : (
                  <span className="text-sm font-semibold">{t3('Gast', 'Guest', 'ضيف')}</span>
                )}
                <a href={`mailto:${order.user?.email ?? order.guestEmail ?? ''}`} className="text-xs text-muted-foreground hover:underline block truncate">{order.user?.email ?? order.guestEmail}</a>
              </div>
              {order.user?.preferredLang && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${order.user.preferredLang === 'ar' ? 'bg-green-100 text-green-800' : order.user.preferredLang === 'en' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'}`}>{order.user.preferredLang.toUpperCase()}</span>
              )}
            </div>
            {/* Shipping Address */}
            {order.shippingAddress && (
              <div className="mt-4 pt-4 border-t">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2"><MapPin className="h-3.5 w-3.5" /> {t3('Lieferadresse', 'Shipping Address', 'عنوان الشحن')}</div>
                <p className="text-sm">{order.shippingAddress.firstName} {order.shippingAddress.lastName}</p>
                {order.shippingAddress.company && <p className="text-sm text-muted-foreground">{order.shippingAddress.company}</p>}
                <p className="text-sm">{order.shippingAddress.street} {order.shippingAddress.houseNumber}</p>
                <p className="text-sm">{order.shippingAddress.postalCode} {order.shippingAddress.city}</p>
                <p className="text-sm text-muted-foreground">{order.shippingAddress.country}</p>
              </div>
            )}
          </div>

          {/* Shipping */}
          <div className="bg-background border rounded-2xl p-5 shadow-sm" style={{ animation: 'fadeSlideUp 300ms ease-out 150ms both' }}>
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2"><Truck className="h-4 w-4" /> {t3('Versand', 'Shipping', 'الشحن')}</h3>
            {order.shipment ? (
              <div className="space-y-3">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">{t3('Versanddienstleister', 'Carrier', 'شركة الشحن')}</span><span className="font-semibold">{order.shipment.carrier ?? 'DHL'}</span></div>
                {order.shipment.trackingNumber && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Tracking</span>
                    <button onClick={() => copyToClipboard(order.shipment.trackingNumber)} className="font-mono text-xs bg-muted px-2 py-1 rounded-lg hover:bg-muted/80 flex items-center gap-1.5">
                      {order.shipment.trackingNumber} <Copy className="h-3 w-3" />{copied && <Check className="h-3 w-3 text-green-500" />}
                    </button>
                  </div>
                )}
                {order.shipment.trackingUrl && (
                  <a href={order.shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[#d4a853] flex items-center gap-1 hover:underline">
                    {t3('Sendungsverfolgung', 'Track Shipment', 'تتبع الشحنة')} <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {order.shipment.estimatedDelivery && <div className="flex justify-between text-sm"><span className="text-muted-foreground">{t3('Voraussichtlich', 'Estimated', 'المتوقع')}</span><span>{formatDate(order.shipment.estimatedDelivery, locale)}</span></div>}
                <div className="flex gap-2 pt-2">
                  {order.shipment.labelUrl && (
                    <a href={order.shipment.labelUrl} target="_blank" rel="noopener noreferrer" className="flex-1">
                      <Button variant="outline" size="sm" className="w-full gap-1.5 rounded-xl text-xs"><Download className="h-3.5 w-3.5" />{t3('Versandlabel', 'Shipping Label', 'بطاقة الشحن')}</Button>
                    </a>
                  )}
                  <Button variant="outline" size="sm" className="flex-1 gap-1.5 rounded-xl text-xs" onClick={downloadDeliveryNote}><FileText className="h-3.5 w-3.5" />{t3('Lieferschein', 'Delivery Note', 'إشعار التسليم')}</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{t3('Noch kein Versand', 'No shipment yet', 'لم يتم الشحن بعد')}</p>
                {/* Fulfillment Warehouse — only for non-cancelled/refunded orders */}
                {!['cancelled', 'refunded', 'delivered', 'shipped'].includes(order.status) && (
                  <FulfillmentWarehouseSelect
                    orderId={id}
                    currentWarehouseId={order.fulfillmentWarehouseId ?? order.fulfillmentWarehouse?.id ?? null}
                    currentWarehouseName={order.fulfillmentWarehouse?.name ?? null}
                    locale={locale}
                  />
                )}
                {!['cancelled', 'refunded', 'pending'].includes(order.status) && (
                  <div className="space-y-2">
                    <Button size="sm" className="w-full gap-2 rounded-xl bg-[#d4a853] hover:bg-[#c49843] text-white"
                      onClick={async () => {
                        const tracking = prompt(t3('Tracking-Nummer eingeben:', 'Enter tracking number:', 'أدخل رقم التتبع:'))
                        if (tracking) {
                          await api.patch(`/admin/orders/${id}/status`, { status: 'shipped', notes: `Tracking: ${tracking}` })
                          queryClient.invalidateQueries({ queryKey: ['admin-order', id] })
                        }
                      }}>
                      <Truck className="h-4 w-4" />
                      {t3('Als versendet markieren', 'Mark as shipped', 'تحديد كمرسل')}
                    </Button>
                    <Button variant="outline" size="sm" className="w-full gap-2 rounded-xl text-xs" onClick={downloadDeliveryNote}>
                      <FileText className="h-3.5 w-3.5" />{t3('Lieferschein drucken', 'Print delivery note', 'طباعة إشعار التسليم')}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Payment */}
          {order.payment && (
            <div className="bg-background border rounded-2xl p-5 shadow-sm" style={{ animation: 'fadeSlideUp 300ms ease-out 200ms both' }}>
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2"><CreditCard className="h-4 w-4" /> {t3('Zahlung', 'Payment', 'الدفع')}</h3>
              <div className="space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">{t3('Anbieter', 'Provider', 'المزود')}</span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${PROVIDER_COLORS[order.payment.provider?.toLowerCase()] ?? 'bg-gray-100 text-gray-800'}`}>{order.payment.provider}</span>
                </div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">{t3('Methode', 'Method', 'الطريقة')}</span><span className="font-medium">{({stripe_card: t3('Kreditkarte', 'Credit Card', 'بطاقة ائتمان'), apple_pay: 'Apple Pay', google_pay: 'Google Pay', klarna_pay_now: 'Klarna Sofort', klarna_pay_later: t3('Klarna Rechnung', 'Klarna Invoice', 'كلارنا فاتورة'), paypal: 'PayPal', sepa_direct_debit: 'SEPA'} as Record<string, string>)[order.payment.method] ?? order.payment.method}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">{t3('Status', 'Status', 'الحالة')}</span><span className="font-medium">{({captured: t3('Bezahlt', 'Paid', 'مدفوع'), refunded: t3('Erstattet', 'Refunded', 'مسترد'), pending: t3('Ausstehend', 'Pending', 'معلق'), failed: t3('Fehlgeschlagen', 'Failed', 'فشل')} as Record<string, string>)[order.payment.status] ?? order.payment.status}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">{t3('Betrag', 'Amount', 'المبلغ')}</span><span className="font-bold">{formatCurrency(Number(order.payment.amount), locale)}</span></div>
                {order.payment.paidAt && <div className="flex justify-between text-sm"><span className="text-muted-foreground">{t3('Bezahlt am', 'Paid at', 'تاريخ الدفع')}</span><span>{formatDateTime(order.payment.paidAt, locale)}</span></div>}
                {order.payment.providerPaymentId && (
                  <button onClick={() => copyToClipboard(order.payment.providerPaymentId)} className="w-full text-start mt-1 font-mono text-[10px] text-muted-foreground bg-muted px-3 py-1.5 rounded-lg hover:bg-muted/80 flex items-center gap-1.5 truncate">
                    {order.payment.providerPaymentId} <Copy className="h-3 w-3 flex-shrink-0" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Documents */}
          <div className="bg-background border rounded-2xl p-5 shadow-sm" style={{ animation: 'fadeSlideUp 300ms ease-out 250ms both' }}>
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2"><FileText className="h-4 w-4" /> {t3('Dokumente', 'Documents', 'المستندات')}</h3>
            <div className="space-y-2">
              {(order.invoices ?? []).map((inv: any) => (
                <Button key={inv.id} variant="outline" size="sm" className="w-full justify-start gap-2 rounded-xl text-xs" onClick={downloadInvoice}>
                  <Download className="h-3.5 w-3.5" />
                  <span className="font-mono">{inv.invoiceNumber}</span>
                  <span className="text-muted-foreground ltr:ml-auto rtl:mr-auto">{inv.type === 'credit_note' ? t3('Gutschrift', 'Credit Note', 'إشعار دائن') : t3('Rechnung', 'Invoice', 'فاتورة')}</span>
                </Button>
              ))}
              <Button variant="outline" size="sm" className="w-full justify-start gap-2 rounded-xl text-xs" onClick={downloadDeliveryNote}>
                <Printer className="h-3.5 w-3.5" /> {t3('Lieferschein', 'Delivery Note', 'إشعار التسليم')}
              </Button>
            </div>
          </div>

          {/* Actions */}
          {!isCancelled && NEXT_STATUS[currentStatus] && (
            <div className="bg-background border rounded-2xl p-5 shadow-sm" style={{ animation: 'fadeSlideUp 300ms ease-out 300ms both' }}>
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">{t3('Aktion', 'Action', 'الإجراء')}</h3>
              {/* Tracking number field when marking as shipped */}
              {NEXT_STATUS[currentStatus] === 'shipped' && (
                <div className="space-y-2 mb-3">
                  <Input
                    value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)}
                    placeholder={t3('Sendungsnummer (z.B. DHL-123456)', 'Tracking Number (e.g. DHL-123456)', 'رقم التتبع (مثال: DHL-123456)')}
                    className="rounded-xl text-sm" dir="ltr"
                  />
                  <Input
                    value={trackingCarrier} onChange={(e) => setTrackingCarrier(e.target.value)}
                    placeholder={t3('Versanddienstleister (z.B. DHL)', 'Carrier (e.g. DHL)', 'شركة الشحن (مثال: DHL)')}
                    className="rounded-xl text-sm"
                  />
                </div>
              )}
              <Input value={statusNotes} onChange={(e) => setStatusNotes(e.target.value)} placeholder={t3('Notizen (optional)', 'Notes (optional)', 'ملاحظات (اختياري)')} className="mb-3 rounded-xl text-sm" />
              <Button className={`w-full rounded-xl text-white font-semibold ${NEXT_BTN_COLORS[currentStatus] ?? ''}`} disabled={statusMutation.isPending}
                onClick={async () => {
                  // If shipping, create shipment record first
                  if (NEXT_STATUS[currentStatus] === 'shipped' && trackingNumber) {
                    try {
                      await api.post('/shipments', { orderId: id, trackingNumber, carrier: trackingCarrier || 'DHL', trackingUrl: trackingNumber.startsWith('http') ? trackingNumber : undefined })
                    } catch {}
                  }
                  statusMutation.mutate(NEXT_STATUS[currentStatus])
                }}>
                {statusMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin ltr:mr-2 rtl:ml-2" /> : <Check className="h-4 w-4 ltr:mr-2 rtl:ml-2" />}
                {nextStatusLabel[currentStatus]}
              </Button>
            </div>
          )}

          {/* Notes */}
          <div className="bg-background border rounded-2xl p-5 shadow-sm" style={{ animation: 'fadeSlideUp 300ms ease-out 350ms both' }}>
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2"><StickyNote className="h-4 w-4" /> {t3('Interne Notizen', 'Internal Notes', 'ملاحظات داخلية')}</h3>
            <div className="flex gap-2">
              <Input ref={notesRef} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t3('Notiz hinzufügen...', 'Add a note...', 'أضف ملاحظة...')} className="flex-1 rounded-xl text-sm"
                onKeyDown={(e) => { if (e.key === 'Enter' && notes.trim()) noteMutation.mutate() }} />
              <Button size="sm" className="rounded-xl bg-[#d4a853] hover:bg-[#c4983f] text-white" disabled={!notes.trim() || noteMutation.isPending} onClick={() => noteMutation.mutate()}>
                {noteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t3('Hinzufügen', 'Add', 'إضافة')}
              </Button>
            </div>
          </div>

          {/* Vorkasse: Confirm Payment */}
          {order.payment?.provider === 'VORKASSE' && order.payment?.status === 'pending' && (
            <div className="bg-[#d4a853]/5 border-2 border-[#d4a853]/30 rounded-2xl p-5 shadow-sm" style={{ animation: 'fadeSlideUp 300ms ease-out 400ms both' }}>
              <h3 className="text-sm font-bold text-[#d4a853] mb-3 flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                {t3('Vorkasse — Zahlung bestätigen', 'Bank Transfer — Confirm Payment', 'تحويل بنكي — تأكيد الدفع')}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {t3(
                  'Bestätige den Zahlungseingang per Banküberweisung. Die Bestellung wird dann automatisch bearbeitet und eine Rechnung erstellt.',
                  'Confirm the bank transfer has been received. The order will be automatically processed and an invoice generated.',
                  'أكد استلام التحويل البنكي. سيتم تجهيز الطلب تلقائياً وإنشاء الفاتورة.'
                )}
              </p>
              <Button
                className="w-full rounded-xl font-semibold gap-2 bg-[#d4a853] text-white hover:bg-[#c49b45]"
                onClick={async () => {
                  const ok = await confirm({
                    title: t3('Zahlungseingang bestätigen', 'Confirm Payment Received', 'تأكيد استلام الدفع'),
                    description: t3(
                      `Wurde der Betrag von ${formatCurrency(Number(order.totalAmount), locale)} für Bestellung ${order.orderNumber} überwiesen?`,
                      `Has the amount of ${formatCurrency(Number(order.totalAmount), locale)} been received for order ${order.orderNumber}?`,
                      `هل تم استلام مبلغ ${formatCurrency(Number(order.totalAmount), locale)} للطلب ${order.orderNumber}؟`
                    ),
                    confirmLabel: t3('Ja, Zahlung eingegangen', 'Yes, Payment Received', 'نعم، تم استلام الدفع'),
                    cancelLabel: t3('Abbrechen', 'Cancel', 'إلغاء'),
                  })
                  if (ok) {
                    try {
                      await api.post(`/payments/${order.id}/confirm-vorkasse`)
                      queryClient.invalidateQueries({ queryKey: ['admin-order'] })
                    } catch (err: any) {
                      alert(err?.response?.data?.message ?? 'Error')
                    }
                  }
                }}
              >
                <Check className="h-4 w-4" />
                {t3('Zahlung eingegangen', 'Payment Received', 'تم استلام الدفع')}
              </Button>
            </div>
          )}

          {/* Danger Zone */}
          {canCancel && !isCancelled && (
            <div className="bg-background border-2 border-red-200 rounded-2xl p-5 shadow-sm" style={{ animation: 'fadeSlideUp 300ms ease-out 400ms both' }}>
              <h3 className="text-sm font-bold uppercase tracking-wider text-red-600 mb-3 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {t3('Gefahrenzone', 'Danger Zone', 'منطقة الخطر')}</h3>
              <Button variant="destructive" className="w-full rounded-xl font-semibold gap-2" disabled={cancelMutation.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: t3('Bestellung stornieren & erstatten', 'Cancel & Refund Order', 'إلغاء الطلب واسترداد المبلغ'),
                    description: t3(
                      `Bestellung ${order.orderNumber} wird storniert und der Betrag von ${formatCurrency(Number(order.totalAmount), locale)} erstattet. Diese Aktion kann nicht rückgängig gemacht werden.`,
                      `Order ${order.orderNumber} will be cancelled and ${formatCurrency(Number(order.totalAmount), locale)} will be refunded. This action cannot be undone.`,
                      `سيتم إلغاء الطلب ${order.orderNumber} واسترداد مبلغ ${formatCurrency(Number(order.totalAmount), locale)}. لا يمكن التراجع عن هذا الإجراء.`
                    ),
                    confirmLabel: t3('Stornieren & Erstatten', 'Cancel & Refund', 'إلغاء واسترداد'),
                    cancelLabel: t3('Abbrechen', 'Go Back', 'رجوع'),
                    variant: 'danger',
                  })
                  if (ok) cancelMutation.mutate(t3('Admin-Stornierung', 'Admin cancellation', 'إلغاء من المسؤول'))
                }}>
                {cancelMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                {t3('Stornieren + Erstatten', 'Cancel + Refund', 'إلغاء + استرداد')}
              </Button>

              {/* Partial Cancel */}
              {order.items?.length > 1 && (
                <div className="mt-4 pt-4 border-t border-red-100">
                  <button onClick={() => setShowPartialCancel(!showPartialCancel)} className="w-full flex items-center justify-between text-xs font-semibold text-orange-700 hover:text-orange-800">
                    <span className="flex items-center gap-1.5"><RotateCcw className="h-3.5 w-3.5" /> {t3('Einzelne Artikel stornieren', 'Cancel Individual Items', 'إلغاء عناصر محددة')}</span>
                    <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showPartialCancel ? 'rotate-90' : ''}`} />
                  </button>
                  {showPartialCancel && (
                    <div className="mt-3 space-y-2">
                      {(order.items ?? []).filter((i: any) => i.quantity > 0).map((item: any) => (
                        <label key={item.id} className={`flex items-center gap-3 p-2.5 rounded-xl border text-sm cursor-pointer transition-all ${partialCancelIds.has(item.id) ? 'border-orange-400 bg-orange-50' : 'hover:bg-muted/30'}`}>
                          <input type="checkbox" checked={partialCancelIds.has(item.id)} onChange={() => { const n = new Set(partialCancelIds); n.has(item.id) ? n.delete(item.id) : n.add(item.id); setPartialCancelIds(n) }} className="h-4 w-4 rounded accent-orange-500" />
                          <div className="flex-1 min-w-0">
                            <span className="font-medium truncate block">{item.snapshotName}</span>
                            <span className="text-xs text-muted-foreground">{item.quantity}x &middot; {formatCurrency(Number(item.totalPrice), locale)}</span>
                          </div>
                        </label>
                      ))}
                      {partialCancelIds.size > 0 && (
                        <div className="space-y-2 pt-2">
                          <div className="bg-orange-50 rounded-xl p-3 text-xs text-orange-800 font-medium">
                            {t3('Erstattungsbetrag', 'Refund Amount', 'مبلغ الاسترداد')}: <strong>{formatCurrency((order.items ?? []).filter((i: any) => partialCancelIds.has(i.id)).reduce((s: number, i: any) => s + Number(i.totalPrice), 0), locale)}</strong>
                          </div>
                          <Input value={partialCancelReason} onChange={(e) => setPartialCancelReason(e.target.value)} placeholder={t3('Grund der Teilstornierung', 'Reason for partial cancellation', 'سبب الإلغاء الجزئي')} className="rounded-xl text-sm" />
                          <Button variant="outline" size="sm" className="w-full rounded-xl border-orange-300 text-orange-700 hover:bg-orange-50" disabled={!partialCancelReason || partialCancelMutation.isPending} onClick={() => partialCancelMutation.mutate()}>
                            {partialCancelMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin ltr:mr-1.5 rtl:ml-1.5" />}
                            {t3(`${partialCancelIds.size} Artikel stornieren`, `Cancel ${partialCancelIds.size} Item(s)`, `إلغاء ${partialCancelIds.size} عنصر`)}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
