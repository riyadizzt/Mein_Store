'use client'

import { API_BASE_URL } from '@/lib/env'
import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import Image from 'next/image'
import {
  Elements,
  CardNumberElement,
  CardExpiryElement,
  CardCvcElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js'
import { ArrowLeft, Loader2, CreditCard, Lock, Shield, Building2, ChevronDown, MapPin } from 'lucide-react'
import { useCheckoutStore } from '@/store/checkout-store'
import { useCartStore } from '@/store/cart-store'
import { useAuthStore } from '@/store/auth-store'
import { CouponInput } from '@/components/coupon-input'
import { getChannelFromUtm } from '@/components/utm-capture'
import { useShopSettings } from '@/hooks/use-shop-settings'
import { getStripe } from '@/lib/stripe'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { VisaLogo, MastercardLogo, PayPalLogo, KlarnaLogo, SumUpLogo } from '@/components/ui/payment-logos'

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
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const { items, subtotal } = useCartStore()
  const cartSubtotal = subtotal()
  const [stockError, setStockError] = useState(false)
  const [sumupMounted, setSumupMounted] = useState(false)

  const { appliedCoupon, discountAmount } = useCheckoutStore()
  const rawShipping = Number(shippingOption?.price ?? 0)
  const shippingCost = appliedCoupon?.freeShipping ? 0 : rawShipping
  const totalAmount = cartSubtotal + shippingCost - (discountAmount || 0)

  const klarnaEnabled = !!shopSettings?.klarnaEnabled
  const [vorkasseData, setVorkasseData] = useState<any>(null)
  const [sumupEnabled, setSumupEnabled] = useState(false)
  const [sumupLoaded, setSumupLoaded] = useState(false)
  const [paypalEnabled, setPaypalEnabled] = useState(false)

  // Fetch available payment methods
  useEffect(() => {
    api.get('/payments/methods').then(({ data }) => {
      if (data?.vorkasse && data?.vorkasseBankDetails) {
        setVorkasseData(data.vorkasseBankDetails)
      }
      if (data?.sumup) setSumupEnabled(true)
      if (data?.paypal) setPaypalEnabled(true)
    }).catch(() => {})
  }, [])

  // Load SumUp SDK script
  useEffect(() => {
    if (!sumupEnabled || sumupLoaded) return
    if (document.getElementById('sumup-sdk')) { setSumupLoaded(true); return }
    const script = document.createElement('script')
    script.id = 'sumup-sdk'
    script.src = 'https://gateway.sumup.com/gateway/ecom/card/v2/sdk.js'
    script.async = true
    script.onload = () => setSumupLoaded(true)
    document.head.appendChild(script)
  }, [sumupEnabled, sumupLoaded])

  const vorkasseEnabled = !!vorkasseData?.enabled
  const [activeTab, setActiveTabRaw] = useState<'card' | 'klarna' | 'vorkasse' | 'sumup' | 'paypal'>('card')
  const setActiveTab = (tab: typeof activeTab) => {
    setActiveTabRaw(tab)
    if (tab !== 'sumup') setSumupMounted(false)
    // Clear any stale error from a previous method — e.g. "card number
    // incomplete" from an aborted Stripe attempt should not linger when the
    // customer switches to Vorkasse. Makes the new method feel like a fresh
    // attempt.
    setError(null)
  }

  // Mobile-only collapsible state for the order summary. Defaults to collapsed
  // (just like Shopify / Stripe Checkout) so the payment form stays in view.
  const [mobileSummaryOpen, setMobileSummaryOpen] = useState(false)

  // SumUp is the only payment flow where the customer sits on a mounted widget
  // in the SAME tab with a pending order created. If they close the tab now,
  // the order is orphaned as pending_payment until the cron sweeps it. We
  // fire a keepalive abort on pagehide/beforeunload so the order cancels
  // immediately. Cleared on successful verify / method switch / unmount.
  const pendingSumupOrderIdRef = useRef<string | null>(null)

  useEffect(() => {
    const fireAbort = () => {
      const orderId = pendingSumupOrderIdRef.current
      if (!orderId) return
      // keepalive: request survives the tab unload; body is empty — the
      // endpoint only needs the orderId in the URL. Safe against abuse
      // because abortPendingOrder() guards on order state (no-op if paid).
      try {
        fetch(`${API_BASE_URL}/api/v1/payments/${orderId}/abort`, {
          method: 'POST',
          keepalive: true,
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        }).catch(() => {})
      } catch {
        // keepalive not supported → silently give up; cron will clean up.
      }
      pendingSumupOrderIdRef.current = null
    }
    window.addEventListener('pagehide', fireAbort)
    window.addEventListener('beforeunload', fireAbort)
    return () => {
      // Soft-navigation cleanup: fire on component unmount too, so clicking
      // the logo or hitting the back button also aborts a stuck SumUp widget.
      fireAbort()
      window.removeEventListener('pagehide', fireAbort)
      window.removeEventListener('beforeunload', fireAbort)
    }
  }, [])

  // Any switch away from SumUp means the customer is continuing the order
  // with a different method — do NOT abort, the order stays valid.
  useEffect(() => {
    if (!sumupMounted) pendingSumupOrderIdRef.current = null
  }, [sumupMounted])

  const handlePlaceOrder = useCallback(async () => {
    if (!termsAccepted || isProcessing) return

    // Only Stripe card needs stripe/elements
    if (activeTab === 'card') {
      if (!stripe || !elements) return
    }

    // Stripe needs ONE of the card-group elements as the payment_method.card argument —
    // it auto-collects the values of the sibling expiry + CVC elements internally.
    const cardElement = activeTab === 'card' ? elements?.getElement(CardNumberElement) : null
    if (activeTab === 'card' && !cardElement) return

    // Defensive guard — the backend now rejects anonymous orders with
    // GuestEmailRequired, but we should never even hit the network in
    // that state. If somehow the user reached the payment step without
    // a guest email AND without being logged in (e.g. persisted state
    // got mangled, tab restored from crash), bounce them back to the
    // guest-or-login step instead of showing an opaque Stripe error.
    if (!isAuthenticated && !guestEmail?.trim()) {
      setError(
        locale === 'ar' ? 'الرجاء إدخال بريدك الإلكتروني للمتابعة.' :
        locale === 'en' ? 'Please enter your email to continue.' :
        'Bitte gib deine E-Mail-Adresse ein, um fortzufahren.',
      )
      setStep('guest')
      return
    }

    setProcessing(true)
    setError(null)

    try {
      const idempotencyKey = generateIdempotencyKey()
      const method = activeTab === 'vorkasse' ? 'vorkasse' : activeTab === 'sumup' ? 'sumup' : activeTab === 'paypal' ? 'paypal' : activeTab === 'klarna' ? 'klarna_pay_now' : 'stripe_card'
      setPaymentMethod(method as any)

      // 1. Create order — mit vollständiger Adresse
      const couponCode = useCheckoutStore.getState().couponCode
      const orderPayload: Record<string, any> = {
        items: items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
        countryCode: shippingAddress?.country ?? 'DE',
        channel: getChannelFromUtm(),
        locale,
        ...(couponCode ? { couponCode } : {}),
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

      // SumUp: Mount card widget with checkout_id
      if (activeTab === 'sumup' && payment.clientSecret && sumupLoaded) {
        const sumupLocale = locale === 'ar' ? 'en-GB' : locale === 'en' ? 'en-GB' : 'de-DE'
        const SumUpCard = (window as any).SumUpCard
        if (!SumUpCard) {
          setError(locale === 'ar' ? 'فشل تحميل نموذج الدفع' : 'Zahlungsformular konnte nicht geladen werden')
          setProcessing(false)
          return
        }

        // Arm the beforeunload abort hook BEFORE mounting — from here until
        // the customer pays successfully or switches method, a tab close
        // must abort the order to avoid orphan pending_payment rows.
        pendingSumupOrderIdRef.current = order.id

        // Mount the widget — user enters card details and pays INSIDE the widget
        // We do NOT navigate anywhere until onResponse('success') fires
        SumUpCard.mount({
          id: 'sumup-card',
          checkoutId: payment.clientSecret,
          locale: sumupLocale,
          currency: 'EUR',
          onResponse: async (type: string, body: any) => {
            console.log('[SumUp] onResponse:', type, body)

            if (type === 'success') {
              // Verify with SumUp API that checkout is actually PAID
              try {
                const verifyRes = await fetch(
                  `${API_BASE_URL}/api/v1/payments/${order.id}/verify-sumup`,
                  { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include' },
                )
                const verifyData = await verifyRes.json().catch(() => ({}))

                if (verifyRes.ok && verifyData.paid) {
                  // Disarm the abort hook BEFORE navigating away — the order
                  // is confirmed, the pagehide event must NOT cancel it.
                  pendingSumupOrderIdRef.current = null
                  try {
                    sessionStorage.setItem('malak-last-order', JSON.stringify({
                      orderNumber: order.orderNumber, orderId: order.id,
                      totalAmount: order.totalAmount, subtotal: order.subtotal,
                      shippingCost: order.shippingCost, taxAmount: order.taxAmount,
                      guestEmail: guestEmail || '',
                    }))
                  } catch {}
                  window.location.replace(`/${locale}/checkout/confirmation?order=${order.orderNumber}`)
                } else {
                  // Backend says not captured — payment actually failed.
                  // Keep the ref armed: the customer may retry or close the
                  // tab, and we still want the order aborted in the latter
                  // case. If they retry with another method, the switch
                  // handler disarms it then.
                  setError(
                    locale === 'ar' ? 'لم يتم إتمام الدفع. يرجى المحاولة مرة أخرى.'
                    : 'Zahlung nicht abgeschlossen. Bitte erneut versuchen.'
                  )
                  setProcessing(false)
                }
              } catch {
                setError(locale === 'ar' ? 'خطأ في التحقق من الدفع' : 'Zahlungsverifizierung fehlgeschlagen')
                setProcessing(false)
              }
            } else if (type === 'fail' || type === 'error') {
              setError(
                locale === 'ar' ? 'فشل الدفع. يرجى المحاولة مرة أخرى.'
                : locale === 'en' ? 'Payment failed. Please try again.'
                : 'Zahlung fehlgeschlagen. Bitte erneut versuchen.'
              )
              setProcessing(false)
            }
            // 'sent', 'auth-screen' → do nothing, widget handles it
          },
        })

        // Widget is now mounted — stop processing spinner, user interacts with widget
        setSumupMounted(true)
        setProcessing(false)
        // CRITICAL: return here — do NOT fall through to goToConfirmation()
        return
      }

      // Klarna or PayPal: redirect to provider
      if ((activeTab === 'klarna' || activeTab === 'paypal') && payment.redirectUrl) {
        // Save order data before redirect so confirmation page can use it
        try {
          sessionStorage.setItem('malak-last-order', JSON.stringify({
            orderNumber: order.orderNumber, orderId: order.id,
            totalAmount: order.totalAmount, paymentMethod: activeTab,
          }))
          // PayPal: save orderId for capture after redirect back
          if (activeTab === 'paypal') {
            sessionStorage.setItem('malak-paypal-orderId', order.id)
            sessionStorage.setItem('malak-payment-method', 'paypal')
          }
        } catch {}
        window.location.href = payment.redirectUrl
        return
      }

      // Confirm payment on backend (fire-and-forget) + navigate
      const goToConfirmation = () => {
        // 1. Confirm payment (don't await — we don't need the response)
        fetch(`${API_BASE_URL}/api/v1/payments/${order.id}/confirm`, {
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

        // Any other status (processing, canceled, etc.) — show error, don't confirm
        setError(locale === 'ar' ? 'لم يتم إتمام الدفع. يرجى المحاولة مرة أخرى.' : 'Zahlung nicht abgeschlossen. Bitte erneut versuchen.')
        setProcessing(false)
        return
      }

      // Klarna redirect already handled above — if we reach here, something is wrong
      setError(locale === 'ar' ? 'حدث خطأ في الدفع' : 'Zahlungsfehler')
      setProcessing(false)
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

  // Reusable order-summary content (used twice: mobile collapsible + desktop sticky)
  const addressLabel =
    locale === 'ar' ? 'عنوان التوصيل' : locale === 'en' ? 'Shipping address' : 'Lieferadresse'
  const editLabel =
    locale === 'ar' ? 'تعديل' : locale === 'en' ? 'Edit' : 'Bearbeiten'

  const orderSummaryContent = (
    <>
      {/* Shipping address block — Zalando-style recap above the items */}
      {shippingAddress && (shippingAddress.street || shippingAddress.city) && (
        <div className="pb-4 border-b">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              {addressLabel}
            </div>
            <button
              type="button"
              onClick={() => setStep('address')}
              className="text-xs font-medium underline underline-offset-2 text-foreground/80 hover:text-foreground transition-colors"
            >
              {editLabel}
            </button>
          </div>
          <div className="text-xs leading-relaxed text-foreground/90" dir="ltr">
            <div className="font-medium">
              {shippingAddress.firstName} {shippingAddress.lastName}
            </div>
            {shippingAddress.company && <div>{shippingAddress.company}</div>}
            <div>
              {shippingAddress.street} {shippingAddress.houseNumber}
            </div>
            {shippingAddress.addressLine2 && <div>{shippingAddress.addressLine2}</div>}
            <div>
              {shippingAddress.postalCode} {shippingAddress.city}
            </div>
            <div className="text-muted-foreground">
              {shippingAddress.country === 'DE'
                ? locale === 'ar'
                  ? 'ألمانيا'
                  : locale === 'en'
                    ? 'Germany'
                    : 'Deutschland'
                : shippingAddress.country}
            </div>
          </div>
        </div>
      )}
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
        <div className="flex justify-between font-bold text-base pt-2 border-t"><span>{tCart('total')}</span><span>&euro;{totalAmount.toFixed(2)}</span></div>
        <p className="text-[11px] text-muted-foreground text-end">
          {locale === 'ar'
            ? `شامل ${(totalAmount - (totalAmount / 1.19)).toFixed(2)}€ ضريبة القيمة المضافة`
            : locale === 'en'
              ? `Incl. €${(totalAmount - (totalAmount / 1.19)).toFixed(2)} VAT`
              : `Inkl. ${(totalAmount - (totalAmount / 1.19)).toFixed(2)} € MwSt.`}
        </p>
        <div className="pt-3 border-t">
          <CouponInput subtotal={cartSubtotal} />
        </div>
      </div>
    </>
  )

  return (
    <div className="max-w-3xl mx-auto py-6">
      {/* Mobile-only collapsible Order Summary — appears ABOVE payment methods */}
      <div className="lg:hidden mb-4 border rounded-2xl overflow-hidden">
        <button
          type="button"
          onClick={() => setMobileSummaryOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors"
          aria-expanded={mobileSummaryOpen}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            {t('orderSummary')}
            <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${mobileSummaryOpen ? 'rotate-180' : ''}`} />
          </span>
          <span className="text-base font-bold">&euro;{totalAmount.toFixed(2)}</span>
        </button>
        <div
          className="grid transition-[grid-template-rows] duration-300 ease-out"
          style={{ gridTemplateRows: mobileSummaryOpen ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            <div className="p-4 space-y-4">
              {orderSummaryContent}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-10">
        {/* Left: Payment */}
        <div className="space-y-6">
          <h2 className="text-2xl font-bold">{t('payment.title')}</h2>

          {error && (
            <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive animate-fade-up" role="alert">
              {error}
            </div>
          )}

          {/* Payment methods — Zalando-style radio rows */}
          <div className="border rounded-2xl overflow-hidden divide-y">
            {/* Kreditkarte */}
            <label className={`flex items-center gap-4 px-5 py-5 cursor-pointer transition-all duration-200 ${activeTab === 'card' ? 'bg-[#d4a853]/5 border-s-[3px] border-s-[#d4a853]' : 'hover:bg-muted/30'}`} onClick={() => setActiveTab('card')}>
              <div className={`h-6 w-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${activeTab === 'card' ? 'border-[#d4a853] scale-110' : 'border-muted-foreground/30'}`}>
                {activeTab === 'card' && <div className="h-3 w-3 rounded-full bg-[#d4a853] animate-[scale-in_150ms_ease-out]" />}
              </div>
              <span className="font-semibold text-base flex-1">{t('paymentMethods.card')}</span>
              <div className="flex items-center gap-2">
                <VisaLogo /><MastercardLogo />
              </div>
            </label>

            {/* PayPal */}
            {paypalEnabled && (
              <label className={`flex items-center gap-4 px-5 py-5 cursor-pointer transition-all duration-200 ${activeTab === 'paypal' ? 'bg-[#d4a853]/5 border-s-[3px] border-s-[#d4a853]' : 'hover:bg-muted/30'}`} onClick={() => setActiveTab('paypal')}>
                <div className={`h-6 w-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${activeTab === 'paypal' ? 'border-[#d4a853] scale-110' : 'border-muted-foreground/30'}`}>
                  {activeTab === 'paypal' && <div className="h-3 w-3 rounded-full bg-[#d4a853] animate-[scale-in_150ms_ease-out]" />}
                </div>
                <span className="font-semibold text-base flex-1">PayPal</span>
                <PayPalLogo />
              </label>
            )}

            {/* SumUp */}
            {sumupEnabled && (
              <label className={`flex items-center gap-4 px-5 py-5 cursor-pointer transition-all duration-200 ${activeTab === 'sumup' ? 'bg-[#d4a853]/5 border-s-[3px] border-s-[#d4a853]' : 'hover:bg-muted/30'}`} onClick={() => setActiveTab('sumup')}>
                <div className={`h-6 w-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${activeTab === 'sumup' ? 'border-[#d4a853] scale-110' : 'border-muted-foreground/30'}`}>
                  {activeTab === 'sumup' && <div className="h-3 w-3 rounded-full bg-[#d4a853] animate-[scale-in_150ms_ease-out]" />}
                </div>
                <span className="font-semibold text-base flex-1">SumUp</span>
                <SumUpLogo />
              </label>
            )}

            {/* Vorkasse */}
            {vorkasseEnabled && (
              <>
                <label className={`flex items-center gap-4 px-5 py-5 cursor-pointer transition-all duration-200 ${activeTab === 'vorkasse' ? 'bg-[#d4a853]/5 border-s-[3px] border-s-[#d4a853]' : 'hover:bg-muted/30'}`} onClick={() => setActiveTab('vorkasse')}>
                  <div className={`h-6 w-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${activeTab === 'vorkasse' ? 'border-[#d4a853] scale-110' : 'border-muted-foreground/30'}`}>
                    {activeTab === 'vorkasse' && <div className="h-3 w-3 rounded-full bg-[#d4a853] animate-[scale-in_150ms_ease-out]" />}
                  </div>
                  <span className="font-semibold text-base flex-1">{locale === 'ar' ? 'تحويل بنكي (الدفع المسبق)' : locale === 'en' ? 'Bank Transfer (Prepayment)' : 'Vorkasse (Überweisung)'}</span>
                  <div className="h-7 w-7 rounded-md bg-amber-100 flex items-center justify-center"><Building2 className="h-4 w-4 text-amber-700" /></div>
                </label>
                {activeTab === 'vorkasse' && (
                  <div className="px-5 py-4 bg-[#d4a853]/5 text-sm text-muted-foreground leading-relaxed ltr:pl-14 rtl:pr-14 border-s-[3px] border-s-[#d4a853]">
                    {locale === 'ar'
                      ? 'بعد تأكيد الطلب، سنرسل لك معلومات التحويل البنكي عبر البريد الإلكتروني. نحتفظ بالمنتجات لمدة 7 أيام. كلما وصل التحويل أسرع، كلما تم شحن طلبك أسرع.'
                      : locale === 'en'
                      ? 'After placing your order, we will send you the bank transfer details by email. We reserve your items for 7 days. The sooner we receive your payment, the sooner your order will be shipped.'
                      : 'Nach Bestellabschluss senden wir dir die Überweisungsdaten per E-Mail. Wir reservieren die Artikel 7 Tage. Je eher die Zahlung eingeht, desto schneller wird verschickt.'}
                  </div>
                )}
              </>
            )}

            {/* Klarna */}
            {klarnaEnabled && (
              <label className={`flex items-center gap-4 px-5 py-5 cursor-pointer transition-all duration-200 ${activeTab === 'klarna' ? 'bg-[#d4a853]/5 border-s-[3px] border-s-[#d4a853]' : 'hover:bg-muted/30'}`} onClick={() => setActiveTab('klarna')}>
                <div className={`h-6 w-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${activeTab === 'klarna' ? 'border-[#d4a853] scale-110' : 'border-muted-foreground/30'}`}>
                  {activeTab === 'klarna' && <div className="h-3 w-3 rounded-full bg-[#d4a853] animate-[scale-in_150ms_ease-out]" />}
                </div>
                <span className="font-semibold text-base flex-1">Klarna</span>
                <KlarnaLogo />
              </label>
            )}
          </div>
          <style>{`@keyframes scale-in { from { transform: scale(0) } to { transform: scale(1) } }`}</style>

          {/* Card Form — separate elements for clarity on mobile */}
          {activeTab === 'card' && (() => {
            const stripeFieldStyle = {
              style: {
                base: {
                  fontSize: '16px',
                  color: '#1a1a2e',
                  fontFamily: 'Inter, system-ui, sans-serif',
                  '::placeholder': { color: '#9ca3af' },
                },
                invalid: { color: '#dc2626' },
              },
            }
            const labelDeEnAr = {
              cardNumber: locale === 'ar' ? 'رقم البطاقة' : locale === 'en' ? 'Card number' : 'Kartennummer',
              expiry:     locale === 'ar' ? 'تاريخ الانتهاء' : locale === 'en' ? 'Expiry (MM/YY)' : 'Gültig bis (MM/JJ)',
              cvc:        locale === 'ar' ? 'رمز الأمان' : locale === 'en' ? 'Security code' : 'Prüfnummer',
            }
            // Stripe Elements are iframes — dir="rtl" on the document body
            // does NOT reach their internal cursor. In Arabic mode this caused
            // the placeholder to sit on the right but the cursor to start on
            // the left, making every card field feel broken. The universal
            // convention for card data (Shopify, Zalando, Amazon, Stripe's own
            // Checkout): force the INPUT content to LTR while keeping the
            // label in the surrounding RTL flow. Credit card numbers, CVCs,
            // and MM/YY are Latin digits by definition — there is no arabic
            // rendering of "4242 4242 4242 4242".
            const ltrField = 'px-4 py-3.5 border rounded-xl bg-background transition-all focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40'
            return (
              <div className="space-y-3">
                {/* Card Number — full width */}
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    {labelDeEnAr.cardNumber}
                  </label>
                  <div dir="ltr" className={ltrField}>
                    <CardNumberElement options={{ ...stripeFieldStyle, showIcon: true }} />
                  </div>
                </div>
                {/* Expiry + CVC — side by side */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                      {labelDeEnAr.expiry}
                    </label>
                    <div dir="ltr" className={ltrField}>
                      <CardExpiryElement options={stripeFieldStyle} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                      {labelDeEnAr.cvc}
                    </label>
                    <div dir="ltr" className={ltrField}>
                      <CardCvcElement options={stripeFieldStyle} />
                    </div>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Klarna info */}
          {activeTab === 'klarna' && (
            <div className="p-5 rounded-xl bg-[#FFB3C7]/10 border border-[#FFB3C7]/30">
              <p className="text-sm font-medium mb-2">{t('paymentMethods.klarna')}</p>
              <p className="text-sm text-muted-foreground">{t('payment.klarnaInfo')}</p>
              <p className="text-xs text-muted-foreground mt-1">{t('payment.klarnaRedirect')}</p>
            </div>
          )}

          {/* PayPal info */}
          {activeTab === 'paypal' && (
            <div className="p-5 rounded-xl bg-[#FFC439]/10 border border-[#FFC439]/30">
              <p className="text-sm font-medium mb-2">PayPal</p>
              <p className="text-sm text-muted-foreground">
                {locale === 'ar'
                  ? 'ستتم إعادة توجيهك إلى PayPal لإتمام الدفع بأمان.'
                  : locale === 'en'
                    ? 'You will be redirected to PayPal to complete your payment securely.'
                    : 'Du wirst zu PayPal weitergeleitet, um die Zahlung sicher abzuschließen.'}
              </p>
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

          {/* SumUp card widget */}
          {activeTab === 'sumup' && (
            <div className="space-y-3">
              {!sumupMounted && (
                <div className="p-5 rounded-xl bg-muted/30 border text-center space-y-2">
                  <CreditCard className="h-8 w-8 mx-auto text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">
                    {locale === 'ar'
                      ? 'اضغط على الزر أدناه لمتابعة الدفع بالبطاقة عبر SumUp'
                      : locale === 'en'
                        ? 'Click the button below to open the SumUp card payment form'
                        : 'Klicke auf den Button um das SumUp-Kartenformular zu öffnen'}
                  </p>
                </div>
              )}
              <div id="sumup-card" />
            </div>
          )}

          {/* Legal — hidden when SumUp widget is active (has its own submit) */}
          {!sumupMounted && <label className="flex items-start gap-2.5 text-sm cursor-pointer">
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
          </label>}

          {/* Place Order — hidden when SumUp widget is active */}
          {!sumupMounted && (
            <Button
              onClick={handlePlaceOrder}
              disabled={!termsAccepted || isProcessing || (activeTab === 'card' && !stripe) || (activeTab === 'sumup' && !sumupLoaded) || stockError}
              className="w-full h-14 text-base gap-2 bg-accent text-accent-foreground rounded-xl font-semibold hover:bg-accent/90 btn-press"
              size="lg"
            >
              {isProcessing ? (
                <><Loader2 className="h-5 w-5 animate-spin" />{t('processing')}</>
              ) : (
                <><Lock className="h-4 w-4" />{t('placeOrderAmount', { amount: totalAmount.toFixed(2) })}</>
              )}
            </Button>
          )}

          {/* Security */}
          <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Lock className="h-3 w-3" /> SSL</span>
            <span className="flex items-center gap-1"><Shield className="h-3 w-3" /> {t('payment.securePayment')}</span>
            <span className="flex items-center gap-1"><CreditCard className="h-3 w-3" /> PCI DSS</span>
          </div>

          <Button variant="ghost" onClick={() => setStep('shipping')} className="w-full gap-2">
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />{t('payment.backToShipping')}
          </Button>
        </div>

        {/* Right: Order Summary — desktop only (mobile uses the collapsible bar above) */}
        <div className="hidden lg:block">
          <div className="sticky top-20 border rounded-2xl shadow-card p-6 space-y-5">
            <h3 className="font-bold text-lg">{t('orderSummary')}</h3>
            {orderSummaryContent}
          </div>
        </div>
      </div>
    </div>
  )
}
