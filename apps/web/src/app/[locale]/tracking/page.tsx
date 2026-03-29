'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import Image from 'next/image'
import { Search, Package, Truck, CheckCircle2, Clock, ExternalLink, Copy, Loader2, ShoppingBag, Home } from 'lucide-react'
import { api } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

const STEPS = ['ordered', 'processing', 'shipped', 'delivered'] as const
const STATUS_TO_STEP: Record<string, number> = {
  pending: 0, confirmed: 0, processing: 1, label_created: 1, picked_up: 2,
  in_transit: 2, out_for_delivery: 2, shipped: 2, delivered: 3,
}
const STEP_ICONS = [ShoppingBag, Clock, Truck, Home]

function TrackingContent() {
  const t = useTranslations('tracking')
  const locale = useLocale()
  const searchParams = useSearchParams()

  // Determine initial mode from URL params
  const initialMode = searchParams.get('mode') === 'order' ? 'order' : searchParams.get('nr') ? 'tracking' : searchParams.get('orderNumber') ? 'order' : 'order'
  const [mode, setMode] = useState<'order' | 'tracking'>(initialMode)

  // Order lookup state
  const [orderNum, setOrderNum] = useState(searchParams.get('orderNumber') ?? searchParams.get('order') ?? '')
  const [orderEmail, setOrderEmail] = useState(searchParams.get('email') ?? '')
  const [searchOrder, setSearchOrder] = useState({ num: orderNum && orderEmail ? orderNum : '', email: orderNum && orderEmail ? orderEmail : '' })

  // Tracking state
  const [trackingInput, setTrackingInput] = useState(searchParams.get('nr') ?? '')
  const [activeNr, setActiveNr] = useState(searchParams.get('nr') ?? '')

  const [copied, setCopied] = useState(false)

  // Order lookup query
  const { data: orderData, isLoading: orderLoading, isError: orderError } = useQuery({
    queryKey: ['guest-order', searchOrder.num, searchOrder.email],
    queryFn: async () => {
      const { data } = await api.get('/orders/guest', { params: { orderNumber: searchOrder.num, email: searchOrder.email } })
      return data?.error ? null : data
    },
    enabled: !!searchOrder.num && !!searchOrder.email,
    retry: false,
  })

  // Tracking query
  const { data: trackingData, isLoading: trackingLoading, isError: trackingError } = useQuery({
    queryKey: ['tracking', activeNr],
    queryFn: async () => { const { data } = await api.get('/tracking', { params: { nr: activeNr } }); return data },
    enabled: !!activeNr,
    retry: false,
  })

  const handleOrderSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearchOrder({ num: orderNum.trim(), email: orderEmail.trim() })
  }

  const handleTrackingSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setActiveNr(trackingInput.trim())
  }

  // Determine which data to show
  const data = mode === 'order' ? orderData : trackingData
  const loading = mode === 'order' ? orderLoading : trackingLoading
  const hasError = mode === 'order' ? (orderError || (searchOrder.num && !orderLoading && !orderData)) : (trackingError || (activeNr && !trackingLoading && !trackingData))
  const hasSearched = mode === 'order' ? !!searchOrder.num : !!activeNr

  const currentStep = data ? (STATUS_TO_STEP[data.status] ?? STATUS_TO_STEP[data.orderStatus] ?? 0) : 0
  const isDelivered = currentStep >= 3

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-16">
      <div className="text-center mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </div>

      {/* Mode Tabs */}
      <div className="flex border rounded-xl overflow-hidden mb-8">
        <button onClick={() => setMode('order')}
          className={`flex-1 py-3 text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2 ${mode === 'order' ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/80'}`}>
          <Search className="h-4 w-4" />{t('modeOrder')}
        </button>
        <button onClick={() => setMode('tracking')}
          className={`flex-1 py-3 text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2 ${mode === 'tracking' ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/80'}`}>
          <Package className="h-4 w-4" />{t('modeTracking')}
        </button>
      </div>

      {/* Order Lookup Form */}
      {mode === 'order' && (
        <form onSubmit={handleOrderSearch} className="space-y-3 mb-10">
          <Input value={orderNum} onChange={(e) => setOrderNum(e.target.value)} placeholder={t('orderNumberPlaceholder')} className="h-12 font-mono" />
          <Input type="email" value={orderEmail} onChange={(e) => setOrderEmail(e.target.value)} placeholder={t('emailPlaceholder')} className="h-12" />
          <Button type="submit" size="lg" className="w-full gap-2 btn-press" disabled={!orderNum.trim() || !orderEmail.trim() || loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {t('search')}
          </Button>
        </form>
      )}

      {/* Tracking Number Form */}
      {mode === 'tracking' && (
        <form onSubmit={handleTrackingSearch} className="flex gap-2 mb-10">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={trackingInput} onChange={(e) => setTrackingInput(e.target.value)} placeholder={t('placeholder')} className="pl-10 h-12 font-mono" />
          </div>
          <Button type="submit" size="lg" disabled={!trackingInput.trim() || loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : t('search')}
          </Button>
        </form>
      )}

      {/* Not Found */}
      {hasSearched && !loading && hasError && !data && (
        <div className="text-center py-12 text-muted-foreground animate-fade-up">
          <Package className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p className="font-medium">{t('notFound')}</p>
          <p className="text-sm mt-1">{t('notFoundHint')}</p>
        </div>
      )}

      {/* Results */}
      {data && (
        <div className="space-y-8 animate-fade-up">
          {/* Progress Bar */}
          <div className="bg-background border rounded-2xl p-6 sm:p-8">
            <div className="flex items-center justify-between mb-8" dir="ltr">
              {STEPS.map((step, i) => {
                const isActive = i <= currentStep
                const isCurrent = i === currentStep
                const Icon = STEP_ICONS[i]
                return (
                  <div key={step} className="flex flex-col items-center flex-1 relative">
                    {i > 0 && <div className={`absolute top-4 right-1/2 w-full h-0.5 -translate-y-1/2 ${i <= currentStep ? 'bg-green-500' : 'bg-muted'}`} style={{ left: '-50%', zIndex: 0 }} />}
                    <div className={`relative z-10 h-8 w-8 rounded-full flex items-center justify-center transition-all duration-200 ${isActive ? 'bg-green-100 text-green-600' : 'bg-muted text-muted-foreground'} ${isCurrent && !isDelivered ? 'ring-4 ring-green-500/20' : ''}`}>
                      {isActive && i < currentStep ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                    </div>
                    <span className={`text-xs mt-2 font-medium ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>{t(`step_${step}`)}</span>
                  </div>
                )
              })}
            </div>
            <div className={`text-center p-4 rounded-xl ${isDelivered ? 'bg-green-50 text-green-800' : 'bg-primary/5 text-primary'}`}>
              <p className="font-semibold text-lg">{isDelivered ? t('delivered') : data.status === 'in_transit' || data.status === 'out_for_delivery' ? t('inTransit') : t('preparing')}</p>
            </div>
          </div>

          {/* Tracking Number */}
          {(data.trackingNumber || data.orderNumber) && (
            <div className="bg-background border rounded-2xl p-6">
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">{data.trackingNumber ? t('trackingNumber') : t('modeOrder')}</h3>
              <div className="flex items-center gap-3">
                <code className="flex-1 text-lg font-mono font-bold bg-muted/50 px-4 py-3 rounded-xl">{data.trackingNumber ?? data.orderNumber}</code>
                <button onClick={() => { navigator.clipboard.writeText(data.trackingNumber ?? data.orderNumber ?? ''); setCopied(true); setTimeout(() => setCopied(false), 2000) }} className="p-3 hover:bg-muted rounded-xl transition-colors">
                  <Copy className={`h-5 w-5 ${copied ? 'text-green-600' : ''}`} />
                </button>
              </div>
              {data.trackingUrl && (
                <a href={data.trackingUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 mt-3 text-primary hover:underline text-sm font-medium">
                  <ExternalLink className="h-4 w-4" />{t('trackAtCarrier', { carrier: (data.carrier ?? 'DHL').toUpperCase() })}
                </a>
              )}
            </div>
          )}

          {/* Order Items */}
          {data.items && data.items.length > 0 && (
            <div className="bg-background border rounded-2xl p-6">
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">{t('orderItems')} {data.orderNumber && `— ${data.orderNumber}`}</h3>
              <div className="space-y-3">
                {data.items.map((item: any, i: number) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-muted rounded-lg overflow-hidden flex-shrink-0">
                      {(item.imageUrl ?? item.variant?.product?.images?.[0]?.url) && (
                        <Image src={item.imageUrl ?? item.variant?.product?.images?.[0]?.url} alt="" width={48} height={48} className="w-full h-full object-cover" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{item.name ?? item.snapshotName}</p>
                      <p className="text-xs text-muted-foreground">{item.color ?? item.variant?.color}{item.size ?? item.variant?.size ? ` / ${item.size ?? item.variant?.size}` : ''} {item.quantity > 1 ? `x ${item.quantity}` : ''}</p>
                    </div>
                    {item.totalPrice && <span className="text-sm font-mono font-medium">&euro;{Number(item.totalPrice).toFixed(2)}</span>}
                  </div>
                ))}
              </div>
              {data.totalAmount && (
                <div className="border-t mt-4 pt-3 flex justify-between font-semibold">
                  <span>{t('step_ordered')}</span>
                  <span className="font-mono">&euro;{Number(data.totalAmount).toFixed(2)}</span>
                </div>
              )}
            </div>
          )}

          {/* Help */}
          <div className="text-center text-sm text-muted-foreground">
            <p>{t('help')}</p>
            <a href={`/${locale}/contact`} className="text-primary hover:underline">{t('contact')}</a>
          </div>
        </div>
      )}
    </div>
  )
}

export default function TrackingPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
      <TrackingContent />
    </Suspense>
  )
}
