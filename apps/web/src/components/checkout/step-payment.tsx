'use client'

import { useState, useCallback, useEffect } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import Image from 'next/image'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { ArrowLeft, Loader2, CreditCard, Lock, Shield, Building2 } from 'lucide-react'
import { useCheckoutStore } from '@/store/checkout-store'
import { useCartStore } from '@/store/cart-store'
import { CouponInput } from '@/components/coupon-input'
import { getChannelFromUtm } from '@/components/utm-capture'
import { useShopSettings } from '@/hooks/use-shop-settings'
import { getStripe } from '@/lib/stripe'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'

export function StepPayment() {
  const locale = useLocale()
  const stripeLocale = locale === 'ar' ? 'ar' : locale === 'en' ? 'en' : 'de'
  const [stripeReady, setStripeReady] = useState(false)
  const [stripeInstance, setStripeInstance] = useState<any>(null)

  useEffect(() => {
    getStripe().then((s) => { setStripeInstance(s); setStripeReady(true) })
  }, [])

  if (!stripeReady || !stripeInstance) {
    return <div className="max-w-2xl mx-auto py-6"><div className="h-40 animate-shimmer rounded-xl" /></div>
  }

  return (
    <Elements
      stripe={stripeInstance}
      options={{
        locale: stripeLocale as any,
        appearance: {
          theme: 'stripe',
          variables: { colorPrimary: '#1a1a2e', borderRadius: '10px', fontFamily: locale === 'ar' ? 'Cairo, system-ui, sans-serif' : 'Inter, system-ui, sans-serif' },
        },
      }}
    >
      <StepPaymentInner />
    </Elements>
  )
}

function StepPaymentInner() {
  const stripe = useStripe()
  const elements = useElements()
  const t = useTranslations('checkout')
  const tCart = useTranslations('cart')
  const locale = useLocale()
  const { data: shopSettings } = useShopSettings()
  const {
    shippingAddress, shippingOption, termsAccepted, guestEmail,
    savedAddressId,
    isProcessing, error,
    setTermsAccepted, setStep, setProcessing, setError,
    setOrder, generateIdempotencyKey, setPaymentMethod,
  } = useCheckoutStore()
  const { items, subtotal } = useCartStore()
  const cartSubtotal = subtotal()
  const [stockError, setStockError] = useState(false)

  const shippingCost = Number(shippingOption?.price ?? 0)
  const totalAmount = cartSubtotal + shippingCost

  const klarnaEnabled = !!shopSettings?.klarnaEnabled
  const [vorkasseData, setVorkasseData] = useState<any>(null)

  // Fetch available payment methods
  useEffect(() => {
    api.get('/payments/methods').then(({ data }) => {
      if (data?.vorkasse && data?.vorkasseBankDetails) {
        setVorkasseData(data.vorkasseBankDetails)
      }
    }).catch(() => {})
  }, [])

  const vorkasseEnabled = !!vorkasseData?.enabled
  const [activeTab, setActiveTab] = useState<'card' | 'klarna' | 'vorkasse'>('card')

  const handlePlaceOrder = useCallback(async () => {
    if (!termsAccepted || isProcessing) return

    // Vorkasse doesn't need Stripe
    if (activeTab !== 'vorkasse') {
      if (!stripe || !elements) return
    }

    const cardElement = activeTab === 'card' ? elements?.getElement(CardElement) : null
    if (activeTab === 'card' && !cardElement) return

    setProcessing(true)
    setError(null)

    try {
      const idempotencyKey = generateIdempotencyKey()
      const method = activeTab === 'vorkasse' ? 'vorkasse' : activeTab === 'klarna' ? 'klarna_pay_now' : 'stripe_card'
      setPaymentMethod(method as any)

      // 1. Create order — mit vollständiger Adresse
      const orderPayload: Record<string, any> = {
        items: items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
        countryCode: shippingAddress?.country ?? 'DE',
        channel: getChannelFromUtm(),
        locale,
      }

      // Adresse: gespeicherte ID oder inline Objekt
      if (savedAddressId) {
        orderPayload.shippingAddressId = savedAddressId
      } else if (shippingAddress) {
        orderPayload.shippingAddress = {
          firstName: shippingAddress.firstName,
          lastName: shippingAddress.lastName,
          street: shippingAddress.street,
          houseNumber: shippingAddress.houseNumber,
          addressLine2: shippingAddress.addressLine2,
          postalCode: shippingAddress.postalCode,
          city: shippingAddress.city,
          country: shippingAddress.country,
          company: shippingAddress.company,
        }
      }

      // Gast-Daten
      if (guestEmail) {
        orderPayload.guestEmail = guestEmail
        orderPayload.guestFirstName = shippingAddress?.firstName
        orderPayload.guestLastName = shippingAddress?.lastName
      }

      const { data: order } = await api.post('/orders', orderPayload, {
        headers: { 'X-Idempotency-Key': idempotencyKey },
      })

      setOrder(order.id, order.orderNumber)

      // 2. Create payment intent
      const { data: payment } = await api.post('/payments', {
        orderId: order.id,
        method,
        idempotencyKey,
      })

      // Vorkasse: no Stripe confirmation needed — go to confirmation with bank details
      if (activeTab === 'vorkasse') {
        try {
          sessionStorage.setItem('malak-last-order', JSON.stringify({
            orderNumber: order.orderNumber, orderId: order.id,
            totalAmount: order.totalAmount, subtotal: order.subtotal,
            shippingCost: order.shippingCost, taxAmount: order.taxAmount,
            guestEmail: guestEmail || '',
            paymentMethod: 'vorkasse',
            bankDetails: vorkasseData,
          }))
        } catch {}
        window.location.replace(`/${locale}/checkout/confirmation?order=${order.orderNumber}`)
        return
      }

      if (activeTab === 'klarna' && payment.redirectUrl) {
        window.location.href = payment.redirectUrl
        return
      }

      // Confirm payment on backend (fire-and-forget) + navigate
      const goToConfirmation = () => {
        // 1. Confirm payment (don't await — we don't need the response)
        fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/v1/payments/${order.id}/confirm`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        }).catch(() => {})

        // 2. Save order data in sessionStorage so confirmation page can read it instantly
        try {
          sessionStorage.setItem('malak-last-order', JSON.stringify({
            orderNumber: order.orderNumber, orderId: order.id,
            totalAmount: order.totalAmount, subtotal: order.subtotal,
            shippingCost: order.shippingCost, taxAmount: order.taxAmount,
            guestEmail: guestEmail || '',
            guestFirstName: shippingAddress?.firstName || '',
            guestLastName: shippingAddress?.lastName || '',
          }))
        } catch {}

        // 3. Navigate — this ALWAYS works, no async, no race
        window.location.replace(`/${locale}/checkout/confirmation?order=${order.orderNumber}`)
      }

      // 3. Confirm card payment with Stripe
      if (activeTab === 'card' && payment.clientSecret && stripe) {
        const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(payment.clientSecret, {
          payment_method: { card: cardElement! },
        })

        if (stripeError) {
          setError(stripeError.message ?? t('errors.cardNotCharged'))
          setProcessing(false)
          return
        }

        if (paymentIntent?.status === 'succeeded') {
          await goToConfirmation()
          return
        }

        if (paymentIntent?.status === 'requires_action') {
          const { error: confirmError } = await stripe!.confirmCardPayment(payment.clientSecret)
          if (confirmError) {
            setError(confirmError.message ?? t('errors.cardNotCharged'))
            setProcessing(false)
            return
          }
          await goToConfirmation()
          return
        }
      }

      // Fallback success
      await goToConfirmation()
    } catch (err: any) {
      console.error('Checkout error:', err?.response?.data ?? err?.message)
      const status = err?.response?.status
      const msg = err?.response?.data?.message
      let errorMsg: string
      if (Array.isArray(msg)) errorMsg = msg.join(', ')
      else if (typeof msg === 'object' && msg !== null) errorMsg = msg[locale] ?? msg.de ?? msg.en ?? JSON.stringify(msg)
      else errorMsg = msg ?? t('errors.cardNotCharged')
      // Stock error (409) — mark as stock issue so button stays disabled
      if (status === 409) setStockError(true)
      setError(errorMsg)
      setProcessing(false)
    }
  }, [termsAccepted, isProcessing, stripe, elements, activeTab, items, shippingAddress, guestEmail, locale]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="max-w-2xl mx-auto py-6">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 lg:gap-8">
        {/* Left: Payment */}
        <div className="lg:col-span-3 space-y-6">
          <h2 className="text-xl font-bold">{t('payment.title')}</h2>

          {error && (
            <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive animate-fade-up" role="alert">
              {error}
            </div>
          )}

          {/* Payment method tabs */}
          {(klarnaEnabled || vorkasseEnabled) && (
            <div className="flex border rounded-xl overflow-hidden" role="tablist">
              <button
                role="tab"
                aria-selected={activeTab === 'card'}
                onClick={() => setActiveTab('card')}
                className={`flex-1 py-3.5 px-4 text-sm font-medium border-e transition-all duration-200 ${
                  activeTab === 'card' ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/80'
                }`}
              >
                <CreditCard className="h-4 w-4 mx-auto mb-1" />
                {t('paymentMethods.card')}
              </button>
              {klarnaEnabled && (
                <button
                  role="tab"
                  aria-selected={activeTab === 'klarna'}
                  onClick={() => setActiveTab('klarna')}
                  className={`flex-1 py-3.5 px-4 text-sm font-medium border-e transition-all duration-200 ${
                    activeTab === 'klarna' ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/80'
                  }`}
                >
                  Klarna
                </button>
              )}
              {vorkasseEnabled && (
                <button
                  role="tab"
                  aria-selected={activeTab === 'vorkasse'}
                  onClick={() => setActiveTab('vorkasse')}
                  className={`flex-1 py-3.5 px-4 text-sm font-medium transition-all duration-200 ${
                    activeTab === 'vorkasse' ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/80'
                  }`}
                >
                  <Building2 className="h-4 w-4 mx-auto mb-1" />
                  {locale === 'ar' ? 'تحويل بنكي' : locale === 'en' ? 'Bank Transfer' : 'Vorkasse'}
                </button>
              )}
            </div>
          )}

          {/* Card Form — ALWAYS visible when card tab active */}
          {activeTab === 'card' && (
            <div className="p-5 border rounded-xl bg-background transition-all duration-200 focus-within:ring-2 focus-within:ring-primary/20">
              <CardElement
                options={{
                  style: {
                    base: {
                      fontSize: '16px',
                      color: '#1a1a2e',
                      fontFamily: 'Inter, system-ui, sans-serif',
                      '::placeholder': { color: '#9ca3af' },
                    },
                  },
                  hidePostalCode: true,
                }}
              />
            </div>
          )}

          {/* Klarna info */}
          {activeTab === 'klarna' && (
            <div className="p-5 rounded-xl bg-[#FFB3C7]/10 border border-[#FFB3C7]/30">
              <p className="text-sm font-medium mb-2">{t('paymentMethods.klarna')}</p>
              <p className="text-sm text-muted-foreground">{t('payment.klarnaInfo')}</p>
              <p className="text-xs text-muted-foreground mt-1">{t('payment.klarnaRedirect')}</p>
            </div>
          )}

          {/* Vorkasse info */}
          {activeTab === 'vorkasse' && vorkasseData && (
            <div className="p-5 rounded-xl bg-[#d4a853]/5 border border-[#d4a853]/20 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Building2 className="h-4 w-4 text-[#d4a853]" />
                {locale === 'ar' ? 'الدفع المسبق عبر التحويل البنكي' : locale === 'en' ? 'Pay via Bank Transfer' : 'Zahlung per Banküberweisung'}
              </div>
              <p className="text-sm text-muted-foreground">
                {locale === 'ar'
                  ? `بعد تقديم الطلب ستصلك بيانات البنك عبر البريد الإلكتروني. يرجى التحويل خلال ${vorkasseData.paymentDeadlineDays} أيام. سيتم تجهيز طلبك بعد استلام الدفع.`
                  : locale === 'en'
                    ? `After placing the order, you'll receive our bank details by email. Please transfer within ${vorkasseData.paymentDeadlineDays} days. Your order will be processed after payment is received.`
                    : `Nach der Bestellung erhältst du unsere Bankdaten per E-Mail. Bitte überweise den Betrag innerhalb von ${vorkasseData.paymentDeadlineDays} Tagen. Deine Bestellung wird nach Zahlungseingang bearbeitet.`}
              </p>
              <div className="bg-background rounded-lg p-3 text-sm space-y-1 border" dir="ltr">
                <div className="flex justify-between"><span className="text-muted-foreground">{locale === 'ar' ? 'صاحب الحساب' : 'Empfänger'}:</span><span className="font-medium">{vorkasseData.accountHolder}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">IBAN:</span><span className="font-mono font-medium">{vorkasseData.iban}</span></div>
                {vorkasseData.bic && <div className="flex justify-between"><span className="text-muted-foreground">BIC:</span><span className="font-mono">{vorkasseData.bic}</span></div>}
                {vorkasseData.bankName && <div className="flex justify-between"><span className="text-muted-foreground">{locale === 'ar' ? 'البنك' : 'Bank'}:</span><span>{vorkasseData.bankName}</span></div>}
              </div>
            </div>
          )}

          {/* Legal */}
          <label className="flex items-start gap-2.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="rounded mt-0.5"
            />
            <span>
              {locale === 'ar' ? (
                <>قرأت وأوافق على <a href={`/${locale}/legal/agb`} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:no-underline">الشروط والأحكام</a> و<a href={`/${locale}/legal/widerruf`} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:no-underline">سياسة الإلغاء</a></>
              ) : locale === 'en' ? (
                <>I have read and accept the <a href={`/${locale}/legal/agb`} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:no-underline">Terms & Conditions</a> and <a href={`/${locale}/legal/widerruf`} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:no-underline">Withdrawal Policy</a></>
              ) : (
                <>Ich habe die <a href={`/${locale}/legal/agb`} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:no-underline">AGB</a> und <a href={`/${locale}/legal/widerruf`} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:no-underline">Widerrufsbelehrung</a> gelesen und akzeptiere sie.</>
              )}
            </span>
          </label>

          {/* Place Order */}
          <Button
            onClick={handlePlaceOrder}
            disabled={!termsAccepted || isProcessing || (activeTab !== 'vorkasse' && !stripe) || stockError}
            className="w-full h-14 text-base gap-2 bg-accent text-accent-foreground rounded-xl font-semibold hover:bg-accent/90 btn-press"
            size="lg"
          >
            {isProcessing ? (
              <><Loader2 className="h-5 w-5 animate-spin" />{t('processing')}</>
            ) : (
              <><Lock className="h-4 w-4" />{t('placeOrderAmount', { amount: (totalAmount - (useCheckoutStore.getState().discountAmount || 0)).toFixed(2) })}</>
            )}
          </Button>

          {/* Security */}
          <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Lock className="h-3 w-3" /> SSL</span>
            <span className="flex items-center gap-1"><Shield className="h-3 w-3" /> {t('payment.securePayment')}</span>
            <span className="flex items-center gap-1"><CreditCard className="h-3 w-3" /> PCI DSS</span>
          </div>

          <Button variant="ghost" onClick={() => setStep('shipping')} className="w-full gap-2">
            <ArrowLeft className="h-4 w-4" />{t('payment.backToShipping')}
          </Button>
        </div>

        {/* Right: Order Summary */}
        <div className="lg:col-span-2">
          <div className="sticky top-20 border rounded-2xl shadow-card p-5 space-y-4">
            <h3 className="font-semibold">{t('orderSummary')}</h3>
            <div className="space-y-3 max-h-60 overflow-y-auto">
              {items.map((item) => (
                <div key={item.variantId} className="flex gap-3">
                  <div className="w-12 h-12 bg-muted rounded-lg flex-shrink-0 overflow-hidden">
                    {item.imageUrl && <Image src={item.imageUrl} alt={item.name} width={48} height={48} className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{item.names?.[locale] ?? item.name}</p>
                    <p className="text-[10px] text-muted-foreground">{item.color}{item.color && item.size ? ' / ' : ''}{item.size} x {item.quantity}</p>
                  </div>
                  <span className="text-xs font-medium">&euro;{(item.unitPrice * item.quantity).toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="border-t pt-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">{tCart('subtotal')}</span><span>&euro;{cartSubtotal.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{tCart('shipping')}</span><span>{shippingCost === 0 ? t('shippingStep.free') : `€${shippingCost.toFixed(2)}`}</span></div>
              {useCheckoutStore.getState().discountAmount > 0 && (
                <div className="flex justify-between text-green-600 text-xs font-medium">
                  <span>{locale === 'ar' ? 'خصم' : locale === 'en' ? 'Discount' : 'Rabatt'} ({useCheckoutStore.getState().couponCode})</span>
                  <span>-&euro;{useCheckoutStore.getState().discountAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base pt-2 border-t"><span>{tCart('total')}</span><span>&euro;{(totalAmount - (useCheckoutStore.getState().discountAmount || 0)).toFixed(2)}</span></div>
              <p className="text-[11px] text-muted-foreground text-end">
                {locale === 'ar'
                  ? `شامل ${((totalAmount - (useCheckoutStore.getState().discountAmount || 0)) - ((totalAmount - (useCheckoutStore.getState().discountAmount || 0)) / 1.19)).toFixed(2)}€ ضريبة القيمة المضافة`
                  : locale === 'en'
                    ? `Incl. €${((totalAmount - (useCheckoutStore.getState().discountAmount || 0)) - ((totalAmount - (useCheckoutStore.getState().discountAmount || 0)) / 1.19)).toFixed(2)} VAT`
                    : `Inkl. ${((totalAmount - (useCheckoutStore.getState().discountAmount || 0)) - ((totalAmount - (useCheckoutStore.getState().discountAmount || 0)) / 1.19)).toFixed(2)} € MwSt.`}
              </p>
              {/* Coupon Input */}
              <div className="pt-3 border-t">
                <CouponInput subtotal={cartSubtotal} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
