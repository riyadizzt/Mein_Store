'use client'

import { useState, useEffect, useCallback } from 'react'
import { useLocale } from 'next-intl'
// import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Loader2, CreditCard, Wallet, Smartphone, Building2, ArrowRight, Lock } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth-store'
import { Button } from '@/components/ui/button'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '')

const METHODS = [
  { key: 'stripe_card', label: { de: 'Kreditkarte', en: 'Credit Card', ar: 'بطاقة ائتمان' }, icon: CreditCard, color: 'border-violet-300 bg-violet-50' },
  { key: 'paypal', label: { de: 'PayPal', en: 'PayPal', ar: 'PayPal' }, icon: Wallet, color: 'border-blue-300 bg-blue-50' },
  { key: 'sumup', label: { de: 'SumUp', en: 'SumUp', ar: 'SumUp' }, icon: Smartphone, color: 'border-emerald-300 bg-emerald-50' },
  { key: 'vorkasse', label: { de: 'Vorkasse', en: 'Bank Transfer', ar: 'تحويل بنكي' }, icon: Building2, color: 'border-amber-300 bg-amber-50' },
]

function StripeCardForm({ clientSecret, orderId, orderNumber }: { clientSecret: string; orderId: string; orderNumber: string }) {
  const stripe = useStripe()
  const elements = useElements()
  const locale = useLocale()
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')

  const handlePay = async () => {
    if (!stripe || !elements) return
    setProcessing(true)
    setError('')
    const card = elements.getElement(CardElement)
    if (!card) return

    const { error: stripeErr, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: { card },
    })

    if (stripeErr) {
      setError(stripeErr.message ?? 'Payment failed')
      setProcessing(false)
    } else if (paymentIntent?.status === 'succeeded') {
      try { await api.post(`/payments/${orderId}/confirm`) } catch {}
      window.location.href = `/${locale}/checkout/confirmation?order=${orderNumber}`
    }
  }

  return (
    <div className="space-y-4">
      {/* dir="ltr" forces the Stripe iframe cursor to the left in Arabic mode —
          card digits are universally LTR regardless of UI direction. */}
      <div dir="ltr" className="border rounded-xl p-4 bg-white">
        <CardElement options={{
          style: { base: { fontSize: '16px', color: '#0f1419', '::placeholder': { color: '#9ca3af' } } },
          hidePostalCode: true,
        }} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button onClick={handlePay} disabled={processing || !stripe} className="w-full h-12 rounded-xl bg-[#d4a853] text-white hover:bg-[#c49b45] font-semibold gap-2">
        {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
        {locale === 'ar' ? 'ادفع الآن' : locale === 'en' ? 'Pay Now' : 'Jetzt bezahlen'}
      </Button>
    </div>
  )
}

function SumUpWidget({ checkoutId }: { checkoutId: string }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    if (mounted || !checkoutId) return
    const script = document.createElement('script')
    script.src = 'https://gateway.sumup.com/gateway/ecom/card/v2/sdk.js'
    script.async = true
    script.onload = () => {
      const SumUpCard = (window as any).SumUpCard
      if (SumUpCard) {
        SumUpCard.mount({
          id: 'sumup-card-retry',
          checkoutId,
          onResponse: () => { window.location.reload() },
        })
        setMounted(true)
      }
    }
    document.head.appendChild(script)
  }, [checkoutId, mounted])

  return (
    <div>
      <div id="sumup-card-retry" className="min-h-[200px]" />
      {!mounted && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
    </div>
  )
}

function RetryPaymentContent({ orderNumber }: { orderNumber: string }) {
  const locale = useLocale()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [retryData, setRetryData] = useState<any>(null)
  const t = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  // Fetch order
  const { data: order } = useQuery({
    queryKey: ['order-retry', orderNumber],
    queryFn: async () => {
      const { data } = await api.get('/users/me/orders', { params: { limit: 50 } })
      const orders = data?.items ?? data?.data ?? (Array.isArray(data) ? data : [])
      return orders.find((o: any) => o.orderNumber === orderNumber) ?? null
    },
    enabled: isAuthenticated,
  })

  const handleRetry = useCallback(async (method: string) => {
    if (!order?.id) return
    setSelectedMethod(method)
    setLoading(true)
    setRetryData(null)

    try {
      const { data } = await api.post(`/payments/${order.id}/retry`, { method })

      if (data?.redirectUrl) {
        // PayPal/Klarna → redirect
        sessionStorage.setItem('malak-paypal-orderId', order.id)
        sessionStorage.setItem('malak-payment-method', method)
        window.location.href = data.redirectUrl
        return
      }

      if (method === 'vorkasse') {
        try {
          sessionStorage.setItem('malak-last-order', JSON.stringify({
            orderNumber, orderId: order.id,
            totalAmount: Number(order.totalAmount), paymentMethod: 'vorkasse',
            bankDetails: data?.bankDetails,
          }))
        } catch {}
        window.location.href = `/${locale}/checkout/confirmation?order=${orderNumber}&orderId=${order.id}&method=vorkasse`
        return
      }

      // Stripe/SumUp → show widget
      setRetryData(data)
      setLoading(false)
    } catch (err: any) {
      setLoading(false)
      setRetryData({ error: err?.response?.data?.message ?? 'Error' })
    }
  }, [order, orderNumber, locale])

  if (!order) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>

  return (
    <div className="max-w-md mx-auto py-10 px-4">
      <h1 className="text-xl font-bold text-center mb-2">{t('Zahlungsmethode waehlen', 'Choose Payment Method', 'اختر طريقة الدفع')}</h1>
      <p className="text-sm text-muted-foreground text-center mb-6">
        {t('Bestellung', 'Order', 'الطلب')} <span className="font-mono font-medium text-[#d4a853]">{orderNumber}</span> — <span className="font-semibold">&euro;{Number(order.totalAmount).toFixed(2)}</span>
      </p>

      {/* Method selection */}
      {!retryData && (
        <div className="space-y-3 mb-6">
          {METHODS.map(m => (
            <button key={m.key} disabled={loading} onClick={() => handleRetry(m.key)}
              className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 transition-all ${selectedMethod === m.key && loading ? m.color : 'border-border hover:border-[#d4a853]/50 hover:bg-[#d4a853]/5'}`}>
              <m.icon className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium flex-1 text-start">{m.label[locale as 'de' | 'en' | 'ar']}</span>
              {selectedMethod === m.key && loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4 text-muted-foreground" />}
            </button>
          ))}
        </div>
      )}

      {/* Stripe Card Form */}
      {retryData?.clientSecret && selectedMethod === 'stripe_card' && (
        <Elements stripe={stripePromise} options={{ clientSecret: retryData.clientSecret }}>
          <StripeCardForm clientSecret={retryData.clientSecret} orderId={order.id} orderNumber={orderNumber} />
        </Elements>
      )}

      {/* SumUp Widget */}
      {retryData?.clientSecret && selectedMethod === 'sumup' && (
        <SumUpWidget checkoutId={retryData.clientSecret} />
      )}

      {/* Error */}
      {retryData?.error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{typeof retryData.error === 'object' ? (retryData.error[locale] ?? retryData.error.de) : retryData.error}</div>
      )}

      {/* Back */}
      {retryData && (
        <button onClick={() => { setRetryData(null); setSelectedMethod(null) }} className="text-sm text-muted-foreground hover:underline mt-4 block mx-auto">
          {t('Andere Methode waehlen', 'Choose another method', 'اختر طريقة أخرى')}
        </button>
      )}

      <div className="flex items-center justify-center gap-4 mt-8 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><Lock className="h-3 w-3" /> SSL</span>
        <span>PCI DSS</span>
      </div>
    </div>
  )
}

export default function RetryPaymentPage({ params: { orderNumber } }: { params: { orderNumber: string; locale: string } }) {
  return <RetryPaymentContent orderNumber={orderNumber} />
}
