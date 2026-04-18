'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { Ticket, X, Check, Loader2, AlertTriangle } from 'lucide-react'
import { api } from '@/lib/api'
import { useCheckoutStore } from '@/store/checkout-store'

export function CouponInput({ subtotal }: { subtotal: number }) {
  const locale = useLocale()
  const t = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d
  const { appliedCoupon, couponCode, discountAmount, setCoupon, removeCoupon } = useCheckoutStore()

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleApply = async () => {
    if (!input.trim()) return
    setLoading(true)
    setError(null)

    try {
      const { data } = await api.post('/coupons/validate', {
        code: input.trim().toUpperCase(),
        subtotal,
      })

      if (data.valid) {
        const coupon = data.coupon
        let discount = 0

        if (coupon.type === 'percentage' && coupon.discountPercent) {
          discount = subtotal * (coupon.discountPercent / 100)
        } else if (coupon.type === 'fixed_amount' && coupon.discountAmount) {
          discount = Math.min(coupon.discountAmount, subtotal)
        }
        // free_shipping discount is 0 (shipping handled separately)

        setCoupon(coupon.code, coupon, Math.round(discount * 100) / 100)
        setInput('')
      } else {
        const reason = data.reason
        setError(typeof reason === 'object' ? reason[locale] || reason.de : reason)
      }
    } catch (err: any) {
      setError(t('Ungültiger Gutscheincode', 'Invalid coupon code', 'رمز قسيمة غير صالح'))
    }

    setLoading(false)
  }

  // Already applied — show success state
  if (appliedCoupon && couponCode) {
    return (
      <div className="border border-green-200 bg-green-50 rounded-xl p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-green-100 flex items-center justify-center">
              <Check className="h-4 w-4 text-green-600" />
            </div>
            <div>
              <span className="font-mono font-bold text-green-800 text-sm">{couponCode}</span>
              <p className="text-[11px] text-green-600">
                {appliedCoupon.type === 'percentage' ? `${appliedCoupon.discountPercent}% ${t('Rabatt', 'discount', 'خصم')}` :
                 appliedCoupon.type === 'fixed_amount' ? `€${appliedCoupon.discountAmount} ${t('Rabatt', 'discount', 'خصم')}` :
                 t('Gratis Versand', 'Free shipping', 'شحن مجاني')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {discountAmount > 0 && (
              <span className="text-sm font-bold text-green-700">-€{discountAmount.toFixed(2)}</span>
            )}
            {appliedCoupon.freeShipping && (
              <span className="text-xs font-medium text-green-600 bg-green-100 px-2 py-0.5 rounded-full">
                {t('Gratis Versand', 'Free shipping', 'شحن مجاني')}
              </span>
            )}
            <button onClick={removeCoupon} className="p-1 hover:bg-green-100 rounded-lg transition-colors">
              <X className="h-4 w-4 text-green-600" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Ticket className="absolute ltr:left-3 rtl:right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={input}
            onChange={(e) => { setInput(e.target.value.toUpperCase()); setError(null) }}
            onKeyDown={(e) => e.key === 'Enter' && handleApply()}
            placeholder={t('Gutscheincode eingeben', 'Enter coupon code', 'أدخل رمز القسيمة')}
            className="w-full h-10 ltr:pl-10 rtl:pr-10 ltr:pr-3 rtl:pl-3 rounded-xl border bg-background text-sm font-mono uppercase placeholder:normal-case placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-[#d4a853]/30 focus:border-[#d4a853]"
          />
        </div>
        <button
          onClick={handleApply}
          disabled={loading || !input.trim()}
          className="px-4 h-10 rounded-xl bg-[#1a1a2e] text-white text-sm font-medium hover:bg-[#2a2a4e] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : t('Einlösen', 'Apply', 'تطبيق')}
        </button>
      </div>

      {error && (
        // Banner style (amber + AlertTriangle) — same visual language as
        // the refundError banner on the return-detail page. Previously this
        // was a tiny text-xs red paragraph that customers routinely missed,
        // which combined with the silent-drop backend bug produced the
        // ORD-20260418-000001 incident where the customer thought 50MALAK
        // had been applied but the order landed with discount=0.
        <div className="mt-2 px-3 py-2.5 bg-amber-50 border border-amber-300 rounded-lg flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-700 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-900">
              {t('Gutschein nicht angewendet', 'Coupon not applied', 'لم يتم تطبيق القسيمة')}
            </p>
            <p className="text-xs text-amber-800 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/60 mt-1">
        {t('Nur ein Gutschein pro Bestellung.', 'Only one coupon per order.', 'قسيمة واحدة فقط لكل طلب.')}
      </p>
    </div>
  )
}
