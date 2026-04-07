'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Truck, ArrowRight, ArrowLeft, Check } from 'lucide-react'
import { useCheckoutStore, type ShippingOption } from '@/store/checkout-store'
import { useCartStore } from '@/store/cart-store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'

function estimateDelivery(days: number): string {
  const d = new Date()
  let remaining = days
  while (remaining > 0) {
    d.setDate(d.getDate() + 1)
    if (d.getDay() !== 0 && d.getDay() !== 6) remaining--
  }
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' })
}

export function StepShipping() {
  const t = useTranslations('checkout')
  const tCommon = useTranslations('common')
  const { shippingAddress, shippingOption, setShippingOption, setStep } = useCheckoutStore()
  const subtotal = useCartStore((s) => s.subtotal())

  // Fetch ALL shipping zones, then filter by country client-side
  const country = shippingAddress?.country?.toUpperCase() ?? ''
  const { data: allZones, isLoading } = useQuery({
    queryKey: ['shipping-zones-all'],
    queryFn: async () => {
      const { data } = await api.get('/shipping-zones')
      return data as Array<{
        id: string; zoneName: string; basePrice: number;
        freeShippingThreshold: number | null; isActive: boolean;
        countryCodes: string[]
      }>
    },
    staleTime: 5 * 60 * 1000,
  })

  // Filter zones that serve the customer's country
  const zones = (allZones ?? []).filter((z) =>
    z.isActive && z.countryCodes?.some((c: string) => c.toUpperCase() === country)
  )

  // Build shipping options from zones
  const options: ShippingOption[] = zones.map((zone) => {
      const isFree = zone.freeShippingThreshold && subtotal >= Number(zone.freeShippingThreshold)
      return {
        id: zone.id,
        name: zone.zoneName,
        price: isFree ? 0 : Number(zone.basePrice),
        estimatedDelivery: estimateDelivery(3),
        carrier: 'DHL Standard',
      }
    })

  // Auto-select cheapest (in useEffect to avoid setState during render)
  useEffect(() => {
    if (options.length > 0 && !shippingOption) {
      const cheapest = options.reduce((a, b) => (Number(a.price) < Number(b.price) ? a : b))
      setShippingOption(cheapest)
    }
  }, [options.length, shippingOption]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleContinue = () => {
    if (!shippingOption) return
    setStep('payment')
  }

  return (
    <div className="max-w-lg mx-auto py-6">
      <h2 className="text-xl font-bold mb-6">{t('shippingStep.title')}</h2>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="animate-pulse h-20 rounded-lg bg-muted" />
          ))}
        </div>
      ) : options.length === 0 ? (
        <p className="text-muted-foreground">{t('shippingStep.noShipping')}</p>
      ) : (
        <div className="space-y-3">
          {options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setShippingOption(opt)}
              className={`w-full text-start p-4 rounded-lg border-2 transition-colors ${
                shippingOption?.id === opt.id
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-foreground/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`h-5 w-5 rounded-full border-2 flex items-center justify-center ${
                    shippingOption?.id === opt.id ? 'border-primary' : 'border-border'
                  }`}>
                    {shippingOption?.id === opt.id && (
                      <div className="h-2.5 w-2.5 rounded-full bg-primary" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{opt.carrier} — {opt.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                      <Truck className="h-3 w-3" />
                      {t('shippingStep.deliveryBy')} {opt.estimatedDelivery}
                    </div>
                  </div>
                </div>
                <div className="text-end">
                  {Number(opt.price) === 0 ? (
                    <div className="flex items-center gap-1 text-green-600">
                      <Check className="h-4 w-4" />
                      <span className="font-semibold text-sm">{t('shippingStep.free')}</span>
                    </div>
                  ) : (
                    <span className="font-semibold">&euro;{Number(opt.price).toFixed(2)}</span>
                  )}
                </div>
              </div>
            </button>
          ))}

          {/* Free shipping hint */}
          {options.some((o) => o.price > 0) && zones?.some((z) => z.freeShippingThreshold) && (
            <p className="text-xs text-muted-foreground text-center mt-2">
              {t('shippingStep.freeFrom', { amount: Number(zones.find((z) => z.freeShippingThreshold)?.freeShippingThreshold ?? 0).toFixed(2) })}
            </p>
          )}
        </div>
      )}

      <div className="flex gap-3 mt-6">
        <Button variant="outline" onClick={() => setStep('address')} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          {tCommon('back')}
        </Button>
        <Button
          onClick={handleContinue}
          disabled={!shippingOption}
          className="flex-1 gap-2"
          size="lg"
        >
          {t('shippingStep.continueToPayment')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
