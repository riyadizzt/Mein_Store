'use client'

import { useState, useEffect } from 'react'
import {
  Elements, CardElement, PaymentRequestButtonElement,
  useStripe, useElements,
} from '@stripe/react-stripe-js'
import { useTranslations } from 'next-intl'
import { Loader2, Lock } from 'lucide-react'
import { getStripe } from '@/lib/stripe'
import { Button } from '@/components/ui/button'

interface StripePaymentFormProps {
  clientSecret: string
  totalAmount: number // in EUR (e.g. 89.97)
  onSuccess: () => void
  onError: (message: string) => void
}

export function StripePaymentForm({ clientSecret, totalAmount, onSuccess, onError }: StripePaymentFormProps) {
  return (
    <Elements
      stripe={getStripe()}
      options={{
        clientSecret,
        appearance: {
          theme: 'stripe',
          variables: { colorPrimary: '#1a1a2e', borderRadius: '10px', fontFamily: 'Inter, system-ui, sans-serif' },
        },
      }}
    >
      <PaymentFormInner clientSecret={clientSecret} totalAmount={totalAmount} onSuccess={onSuccess} onError={onError} />
    </Elements>
  )
}

function PaymentFormInner({ clientSecret, totalAmount, onSuccess, onError }: StripePaymentFormProps) {
  const stripe = useStripe()
  const elements = useElements()
  const t = useTranslations('checkout')
  const [processing, setProcessing] = useState(false)
  const [paymentRequest, setPaymentRequest] = useState<any>(null)
  const [canMakePayment, setCanMakePayment] = useState(false)

  // Apple Pay / Google Pay setup
  useEffect(() => {
    if (!stripe || !totalAmount) return

    const pr = stripe.paymentRequest({
      country: 'DE',
      currency: 'eur',
      total: { label: 'Malak Bekleidung', amount: Math.round(totalAmount * 100) },
      requestPayerName: true,
      requestPayerEmail: true,
    })

    pr.canMakePayment().then((result) => {
      if (result) {
        setPaymentRequest(pr)
        setCanMakePayment(true)
      }
    })

    pr.on('paymentmethod', async (ev) => {
      const { error, paymentIntent } = await stripe.confirmCardPayment(
        clientSecret,
        { payment_method: ev.paymentMethod.id },
        { handleActions: false },
      )

      if (error) {
        ev.complete('fail')
        onError(error.message ?? t('errors.cardNotCharged'))
      } else if (paymentIntent?.status === 'requires_action') {
        ev.complete('success')
        const { error: confirmError } = await stripe.confirmCardPayment(clientSecret)
        if (confirmError) onError(confirmError.message ?? t('errors.cardNotCharged'))
        else onSuccess()
      } else {
        ev.complete('success')
        onSuccess()
      }
    })
  }, [stripe, totalAmount]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!stripe || !elements) return

    setProcessing(true)

    const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: { card: elements.getElement(CardElement)! },
    })

    if (error) {
      onError(error.message ?? t('errors.cardNotCharged'))
      setProcessing(false)
    } else if (paymentIntent?.status === 'succeeded') {
      onSuccess()
    } else if (paymentIntent?.status === 'requires_action') {
      const { error: confirmError } = await stripe.confirmCardPayment(clientSecret)
      if (confirmError) {
        onError(confirmError.message ?? t('errors.cardNotCharged'))
        setProcessing(false)
      } else {
        onSuccess()
      }
    }
  }

  return (
    <div className="space-y-4">
      {/* Apple Pay / Google Pay */}
      {canMakePayment && paymentRequest && (
        <div className="space-y-3">
          <PaymentRequestButtonElement
            options={{
              paymentRequest,
              style: { paymentRequestButton: { type: 'buy', theme: 'dark', height: '48px' } },
            }}
          />
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">{t('payment.orPayWithCard')}</span>
            <div className="flex-1 h-px bg-border" />
          </div>
        </div>
      )}

      {/* Card Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-4 border rounded-xl bg-background transition-all duration-200 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/30">
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

        <Button
          type="submit"
          disabled={!stripe || processing}
          className="w-full h-12 text-base gap-2 rounded-xl btn-press"
        >
          {processing ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              {t('processing')}
            </>
          ) : (
            <>
              <Lock className="h-4 w-4" />
              {t('payment.payNow')}
            </>
          )}
        </Button>

        <p className="text-[11px] text-muted-foreground text-center">
          {t('payment.cardSecure')}
        </p>
      </form>
    </div>
  )
}
