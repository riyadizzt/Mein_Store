'use client'

/**
 * Public Return Request — /return/[orderId]?token=...
 *
 * Allows guests (stub users, no login) to exercise their 14-day withdrawal
 * right (§355 BGB) without first claiming their account. The link is in
 * the shipped/delivered email and contains a one-time token that matches
 * order.notes.confirmationToken.
 *
 * Flow:
 *   1. GET /public/orders/:id/return-info?token=...  — prefill
 *   2. Customer selects items and reason
 *   3. POST /public/orders/:id/return-request?token=... — submit
 *   4. Success screen with return number
 */

import { useEffect, useState, Suspense } from 'react'
import { useLocale } from 'next-intl'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Loader2, CheckCircle2, AlertCircle, Package, Minus, Plus } from 'lucide-react'
import { API_BASE_URL } from '@/lib/env'

type ReturnItem = {
  variantId: string
  name: string
  sku: string
  color?: string
  size?: string
  quantity: number
  unitPrice: number
  imageUrl?: string | null
}

type PrefillData = {
  orderId: string
  orderNumber: string
  status: string
  deliveredAt: string | null
  deadline: string | null
  daysLeft: number
  canReturn: boolean
  hasActiveReturn: boolean
  items: ReturnItem[]
}

// Keys MUST match prisma ReturnReason enum — checked by class-validator
// on the backend. Wrong values come back as a 400 listing all allowed enums.
const REASONS = [
  { key: 'wrong_size', de: 'Falsche Größe', en: 'Wrong size', ar: 'مقاس خاطئ' },
  { key: 'damaged', de: 'Defekt / Beschädigt', en: 'Defective / damaged', ar: 'معيب / تالف' },
  { key: 'quality_issue', de: 'Qualitätsmangel', en: 'Quality issue', ar: 'مشكلة في الجودة' },
  { key: 'wrong_product', de: 'Falsches Produkt', en: 'Wrong product', ar: 'منتج خاطئ' },
  { key: 'right_of_withdrawal', de: 'Widerruf (14 Tage)', en: 'Right of withdrawal', ar: 'حق الانسحاب' },
  { key: 'changed_mind', de: 'Gefällt mir nicht', en: 'Changed my mind', ar: 'غيرت رأيي' },
  { key: 'other', de: 'Anderer Grund', en: 'Other reason', ar: 'سبب آخر' },
]

function PublicReturnInner() {
  const locale = useLocale()
  const params = useParams()
  const searchParams = useSearchParams()

  const orderId = params.orderId as string
  const token = searchParams.get('token') ?? ''

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prefill, setPrefill] = useState<PrefillData | null>(null)
  const [selectedItems, setSelectedItems] = useState<Record<string, number>>({})
  const [reason, setReason] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [done, setDone] = useState<{ returnNumber: string } | null>(null)

  // ── 1. Pre-fill ──
  useEffect(() => {
    if (!token) {
      setError(
        locale === 'ar' ? 'رابط غير صالح — الرمز مفقود'
          : locale === 'en' ? 'Invalid link — token missing'
            : 'Ungueltiger Link — Token fehlt',
      )
      setLoading(false)
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/v1/public/orders/${orderId}/return-info?token=${encodeURIComponent(token)}`,
        )
        if (cancelled) return
        if (!res.ok) {
          const body: any = await res.json().catch(() => ({}))
          setError(
            body?.message?.[locale] || body?.message ||
            (locale === 'ar' ? 'الرابط غير صالح أو منتهي الصلاحية'
              : locale === 'en' ? 'Invalid or expired link'
                : 'Ungueltiger oder abgelaufener Link'),
          )
          setLoading(false)
          return
        }
        const data: PrefillData = await res.json()
        setPrefill(data)
      } catch {
        if (!cancelled) {
          setError(locale === 'ar' ? 'خطأ في الشبكة' : locale === 'en' ? 'Network error' : 'Netzwerkfehler')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [orderId, token, locale])

  // ── Item selection helpers ──
  const adjustQty = (variantId: string, max: number, delta: number) => {
    setSelectedItems((prev) => {
      const current = prev[variantId] ?? 0
      const next = Math.max(0, Math.min(max, current + delta))
      if (next === 0) {
        const { [variantId]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [variantId]: next }
    })
  }

  const totalItems = Object.values(selectedItems).reduce((s, v) => s + v, 0)
  const totalRefund = Object.entries(selectedItems).reduce((sum, [vid, qty]) => {
    const item = prefill?.items.find((i) => i.variantId === vid)
    return sum + (item ? item.unitPrice * qty : 0)
  }, 0)

  const handleSubmit = async () => {
    if (totalItems === 0 || !reason) return
    setSubmitting(true)
    setError(null)
    try {
      const items = Object.entries(selectedItems).map(([variantId, quantity]) => ({
        variantId,
        quantity,
        reason,
      }))
      const res = await fetch(
        `${API_BASE_URL}/api/v1/public/orders/${orderId}/return-request?token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason, notes, items }),
        },
      )
      const body: any = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(
          body?.message?.[locale] || body?.message ||
          (locale === 'ar' ? 'فشل إرسال طلب الإرجاع' : locale === 'en' ? 'Return request failed' : 'Retoure konnte nicht gesendet werden'),
        )
        setSubmitting(false)
        return
      }
      setDone({ returnNumber: body.returnNumber })
    } catch {
      setError(locale === 'ar' ? 'خطأ في الشبكة' : locale === 'en' ? 'Network error' : 'Netzwerkfehler')
      setSubmitting(false)
    }
  }

  // ── UI states ──
  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#d4a853]" />
      </div>
    )
  }

  if (done) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="h-20 w-20 rounded-full bg-green-50 flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-10 w-10 text-green-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold mb-2">
              {locale === 'ar' ? 'تم استلام طلب الإرجاع' : locale === 'en' ? 'Return request received' : 'Retoure eingegangen'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {locale === 'ar' ? 'رقم الإرجاع' : locale === 'en' ? 'Return number' : 'Retourennummer'}:
            </p>
            <p className="font-mono text-lg font-bold mt-1">{done.returnNumber}</p>
          </div>
          <p className="text-sm text-muted-foreground">
            {locale === 'ar'
              ? 'سنرسل لك بريدًا إلكترونيًا بالتفاصيل والخطوات التالية.'
              : locale === 'en'
                ? 'We will send you an email with details and next steps.'
                : 'Wir senden dir eine E-Mail mit den Details und den naechsten Schritten.'}
          </p>
          <Link href={`/${locale}/products`} className="inline-block px-6 py-3 rounded-full bg-[#d4a853] text-white font-semibold hover:bg-[#c29945] transition-colors">
            {locale === 'ar' ? 'العودة للتسوق' : locale === 'en' ? 'Back to shop' : 'Zurueck zum Shop'}
          </Link>
        </div>
      </div>
    )
  }

  if (error && !prefill) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="h-20 w-20 rounded-full bg-red-50 flex items-center justify-center mx-auto">
            <AlertCircle className="h-10 w-10 text-red-400" />
          </div>
          <h1 className="text-xl font-bold">
            {locale === 'ar' ? 'لا يمكن معالجة الطلب' : locale === 'en' ? 'Cannot process request' : 'Anfrage nicht moeglich'}
          </h1>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Link href={`/${locale}/auth/login`} className="inline-block text-sm text-[#d4a853] hover:underline">
            {locale === 'ar' ? 'تسجيل الدخول وإدارة الطلبات' : locale === 'en' ? 'Log in to manage orders' : 'Einloggen und Bestellungen verwalten'}
          </Link>
        </div>
      </div>
    )
  }

  if (prefill && !prefill.canReturn) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="h-20 w-20 rounded-full bg-amber-50 flex items-center justify-center mx-auto">
            <AlertCircle className="h-10 w-10 text-amber-500" />
          </div>
          <h1 className="text-xl font-bold">
            {prefill.hasActiveReturn
              ? (locale === 'ar' ? 'يوجد طلب إرجاع نشط' : locale === 'en' ? 'Active return already exists' : 'Aktive Retoure existiert bereits')
              : prefill.status !== 'delivered'
                ? (locale === 'ar' ? 'لم يتم تسليم الطلب بعد' : locale === 'en' ? 'Order not delivered yet' : 'Bestellung noch nicht zugestellt')
                : (locale === 'ar' ? 'انتهت فترة الإرجاع' : locale === 'en' ? 'Return period expired' : 'Rueckgabefrist abgelaufen')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {locale === 'ar' ? 'الطلب' : locale === 'en' ? 'Order' : 'Bestellung'} <span className="font-mono">{prefill.orderNumber}</span>
          </p>
        </div>
      </div>
    )
  }

  // ── Main form ──
  return (
    <div className="min-h-[calc(100vh-120px)] py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-[#d4a853]/10 mb-4">
            <Package className="h-8 w-8 text-[#d4a853]" />
          </div>
          <h1 className="text-3xl font-bold mb-2">
            {locale === 'ar' ? 'طلب إرجاع' : locale === 'en' ? 'Return request' : 'Retoure anfordern'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {locale === 'ar' ? 'الطلب' : locale === 'en' ? 'Order' : 'Bestellung'}{' '}
            <span className="font-mono font-bold">{prefill!.orderNumber}</span>
          </p>
          {prefill!.deadline && (
            <p className="text-xs text-muted-foreground mt-2">
              {locale === 'ar' ? 'الموعد النهائي' : locale === 'en' ? 'Deadline' : 'Frist'}:{' '}
              {new Date(prefill!.deadline).toLocaleDateString(locale === 'ar' ? 'ar-EG-u-nu-latn' : locale === 'en' ? 'en-GB' : 'de-DE')}
              {' • '}
              <span className="font-semibold text-amber-700">
                {prefill!.daysLeft} {locale === 'ar' ? 'يوم متبقي' : locale === 'en' ? 'days left' : 'Tage verbleibend'}
              </span>
            </p>
          )}
        </div>

        {/* Items */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border mb-6">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-4">
            {locale === 'ar' ? 'اختر العناصر للإرجاع' : locale === 'en' ? 'Select items to return' : 'Artikel zum Retournieren'}
          </h2>
          <div className="space-y-3">
            {prefill!.items.map((item) => {
              const qty = selectedItems[item.variantId] ?? 0
              return (
                <div key={item.variantId} className={`flex items-center gap-4 p-3 rounded-xl border transition-colors ${qty > 0 ? 'border-[#d4a853] bg-[#d4a853]/5' : 'border-transparent'}`}>
                  <div className="w-16 h-16 bg-muted rounded-lg flex-shrink-0 overflow-hidden">
                    {item.imageUrl ? <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" /> : null}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[item.color, item.size].filter(Boolean).join(' / ')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      €{item.unitPrice.toFixed(2)}  ·  max {item.quantity}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => adjustQty(item.variantId, item.quantity, -1)} disabled={qty === 0} className="h-8 w-8 rounded-full border flex items-center justify-center hover:bg-muted disabled:opacity-30">
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="w-8 text-center font-semibold tabular-nums">{qty}</span>
                    <button type="button" onClick={() => adjustQty(item.variantId, item.quantity, 1)} disabled={qty >= item.quantity} className="h-8 w-8 rounded-full border flex items-center justify-center hover:bg-muted disabled:opacity-30">
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Reason */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border mb-6">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-4">
            {locale === 'ar' ? 'سبب الإرجاع' : locale === 'en' ? 'Reason' : 'Grund'}
          </h2>
          <div className="space-y-2">
            {REASONS.map((r) => (
              <label key={r.key} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${reason === r.key ? 'border-[#d4a853] bg-[#d4a853]/5' : 'hover:bg-muted/30'}`}>
                <input type="radio" name="reason" value={r.key} checked={reason === r.key} onChange={(e) => setReason(e.target.value)} className="accent-[#d4a853]" />
                <span className="text-sm">{(r as any)[locale] ?? r.de}</span>
              </label>
            ))}
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={locale === 'ar' ? 'ملاحظات إضافية (اختياري)' : locale === 'en' ? 'Additional notes (optional)' : 'Zusaetzliche Anmerkungen (optional)'}
            className="mt-4 w-full min-h-[80px] p-3 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-[#d4a853]/20"
          />
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Submit */}
        <div className="sticky bottom-0 bg-white border-t p-4 -mx-4">
          <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground">
                {locale === 'ar' ? 'المجموع' : locale === 'en' ? 'Refund total' : 'Erstattungssumme'}
              </p>
              <p className="text-xl font-bold">€{totalRefund.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">
                {totalItems} {locale === 'ar' ? 'عنصر' : locale === 'en' ? 'items' : 'Artikel'}
              </p>
            </div>
            <button
              type="button"
              disabled={totalItems === 0 || !reason || submitting}
              onClick={handleSubmit}
              className="flex-1 max-w-[220px] h-12 rounded-full bg-[#d4a853] text-white font-semibold hover:bg-[#c29945] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {locale === 'ar' ? 'إرسال' : locale === 'en' ? 'Submit' : 'Absenden'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function PublicReturnPage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh] flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-[#d4a853]" /></div>}>
      <PublicReturnInner />
    </Suspense>
  )
}
