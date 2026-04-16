'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Package, Loader2, Clock, CreditCard, AlertCircle } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  pending_payment: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-800',
  processing: 'bg-blue-100 text-blue-800',
  shipped: 'bg-purple-100 text-purple-800',
  delivered: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-600',
  refunded: 'bg-orange-100 text-orange-800',
  returned: 'bg-orange-100 text-orange-800',
  disputed: 'bg-red-100 text-red-800',
}

type Bucket = 'active' | 'waiting_payment'

function useBucketQuery(bucket: Bucket) {
  return useInfiniteQuery({
    queryKey: ['my-orders', bucket],
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get('/users/me/orders', {
        params: { cursor: pageParam, limit: 10, bucket },
      })
      return data
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: any) => lastPage.nextCursor,
  })
}

export default function OrdersPage() {
  const locale = useLocale()
  const t = useTranslations('account')
  const [bucket, setBucket] = useState<Bucket>('active')

  // Fetch both buckets in parallel so the tab counter is always accurate
  // and switching between tabs feels instant.
  const activeQuery = useBucketQuery('active')
  const waitingQuery = useBucketQuery('waiting_payment')

  const currentQuery = bucket === 'active' ? activeQuery : waitingQuery
  const orders = currentQuery.data?.pages.flatMap((p: any) => p.items ?? p.data ?? []) ?? []
  const waitingCount =
    waitingQuery.data?.pages.flatMap((p: any) => p.items ?? p.data ?? []).length ?? 0

  const waitingLabel =
    locale === 'ar' ? 'بانتظار الدفع' : locale === 'en' ? 'Waiting for payment' : 'Wartet auf Zahlung'
  const activeLabel =
    locale === 'ar' ? 'طلباتي' : locale === 'en' ? 'My orders' : 'Meine Bestellungen'

  const renderSkeletons = () => (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse bg-muted rounded-lg" />)}
    </div>
  )

  const renderError = () => (
    <div className="text-center py-16">
      <div className="h-16 w-16 rounded-full bg-orange-50 flex items-center justify-center mx-auto mb-5">
        <Package className="h-7 w-7 text-orange-400" />
      </div>
      <h2 className="text-lg font-semibold mb-2">{t('ordersErrorTitle')}</h2>
      <p className="text-sm text-muted-foreground mb-5 max-w-xs mx-auto">{t('ordersErrorHint')}</p>
      <Button variant="outline" onClick={() => currentQuery.refetch()} className="btn-press">
        {t('ordersRetry')}
      </Button>
    </div>
  )

  const renderEmptyActive = () => (
    <div className="text-center py-20">
      <div className="h-20 w-20 rounded-full bg-brand-gold/10 flex items-center justify-center mx-auto mb-5">
        <Package className="h-9 w-9 text-brand-gold/40" />
      </div>
      <h2 className="text-lg font-semibold mb-2">{t('orders.empty')}</h2>
      <p className="text-sm text-muted-foreground max-w-xs mx-auto mb-6">{t('ordersEmptyHint')}</p>
      <Link href={`/${locale}/products`}>
        <Button className="gap-2 btn-press">{t('orders.shopNow')}</Button>
      </Link>
    </div>
  )

  const renderEmptyWaiting = () => (
    <div className="text-center py-20">
      <div className="h-20 w-20 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-5">
        <Clock className="h-9 w-9 text-green-400" />
      </div>
      <h2 className="text-lg font-semibold mb-2">
        {locale === 'ar'
          ? 'لا توجد مدفوعات معلقة'
          : locale === 'en'
            ? 'No pending payments'
            : 'Keine offenen Zahlungen'}
      </h2>
      <p className="text-sm text-muted-foreground max-w-xs mx-auto">
        {locale === 'ar'
          ? 'جميع طلباتك مدفوعة'
          : locale === 'en'
            ? 'All your orders are paid.'
            : 'Alle deine Bestellungen sind bezahlt.'}
      </p>
    </div>
  )

  const waitingHint =
    locale === 'ar'
      ? 'هذه طلبات بدأتها ولم تكتمل عملية الدفع. يمكنك استكمال الدفع أو انتظار الإلغاء التلقائي.'
      : locale === 'en'
        ? 'These are orders you started but did not complete payment for. You can finish paying or wait for automatic cancellation.'
        : 'Das sind Bestellungen, die du angefangen, aber noch nicht bezahlt hast. Du kannst die Zahlung fortsetzen oder auf die automatische Stornierung warten.'

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">{t('orders.title')}</h2>

      {/* Tab bar — Zalando-style */}
      <div className="flex items-center gap-1 mb-6 border-b">
        <button
          type="button"
          onClick={() => setBucket('active')}
          className={`relative px-4 py-3 text-sm font-semibold transition-colors ${
            bucket === 'active'
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground/80'
          }`}
        >
          {activeLabel}
          {bucket === 'active' && (
            <span className="absolute inset-x-0 bottom-0 h-[2px] bg-[#d4a853]" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setBucket('waiting_payment')}
          className={`relative flex items-center gap-2 px-4 py-3 text-sm font-semibold transition-colors ${
            bucket === 'waiting_payment'
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground/80'
          }`}
        >
          <Clock className="h-4 w-4" />
          {waitingLabel}
          {waitingCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold">
              {waitingCount}
            </span>
          )}
          {bucket === 'waiting_payment' && (
            <span className="absolute inset-x-0 bottom-0 h-[2px] bg-[#d4a853]" />
          )}
        </button>
      </div>

      {/* Hint banner only on the waiting tab */}
      {bucket === 'waiting_payment' && orders.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <p>{waitingHint}</p>
        </div>
      )}

      {/* Body */}
      {currentQuery.isLoading ? (
        renderSkeletons()
      ) : currentQuery.isError ? (
        renderError()
      ) : orders.length === 0 ? (
        bucket === 'active' ? renderEmptyActive() : renderEmptyWaiting()
      ) : (
        <>
          <div className="space-y-3">
            {orders.map((order: any) => {
              const statusColor = STATUS_COLORS[order.status] ?? 'bg-gray-100'
              const statusLabel = t(`orderStatus.${order.status}` as any, { defaultValue: order.status })
              const isWaiting = bucket === 'waiting_payment'
              // Fix 5: Dim end-state orders (cancelled, refunded)
              const isEndState = ['cancelled', 'refunded'].includes(order.status)
              return (
                <Link
                  key={order.id}
                  href={
                    isWaiting
                      ? `/${locale}/account/orders/${order.orderNumber}/retry-payment`
                      : `/${locale}/account/orders/${order.orderNumber}`
                  }
                  className={`block border rounded-2xl p-4 shadow-card hover:shadow-card-hover transition-all ${
                    isEndState ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-center gap-4">
                    {/* Fix 1: Bigger thumbnails (56px) + Fix 2: Better placeholder */}
                    <div className="flex -space-x-2 flex-shrink-0">
                      {(order.items ?? []).slice(0, 3).map((item: any, idx: number) => {
                        const imgUrl = item.variant?.product?.images?.[0]?.url
                        const itemName = item.snapshotName ?? item.variant?.product?.translations?.[0]?.name ?? ''
                        const initial = (itemName || item.snapshotSku || 'M').charAt(0).toUpperCase()
                        return (
                          <div key={idx} className="h-14 w-14 rounded-xl bg-muted border-2 border-background overflow-hidden">
                            {imgUrl ? (
                              <img src={imgUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-[#f0ebe3] text-[#a09078] text-sm font-semibold select-none">
                                {initial}
                              </div>
                            )}
                          </div>
                        )
                      })}
                      {(order.items ?? []).length > 3 && (
                        <div className="h-14 w-14 rounded-xl bg-muted border-2 border-background flex items-center justify-center text-xs text-muted-foreground font-medium">
                          +{(order.items ?? []).length - 3}
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        {/* Fix 4: Shorter order number on mobile */}
                        <p className="font-mono font-semibold text-sm">
                          <span className="hidden sm:inline">{order.orderNumber}</span>
                          <span className="sm:hidden">#{(order.orderNumber as string).split('-').pop()}</span>
                        </p>
                        <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${statusColor}`}>
                          {statusLabel}
                        </span>
                      </div>
                      {/* Fix 3: Date with leading zeros */}
                      <p className="text-xs text-muted-foreground">
                        {new Date(order.createdAt).toLocaleDateString(locale === 'ar' ? 'ar-EG-u-nu-latn' : locale === 'en' ? 'en-GB' : 'de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })} &middot; {t('orders.itemCount', { count: (order.items ?? []).length })}
                      </p>
                    </div>

                    {/* Fix 6: Price always visible */}
                    <div className="flex-shrink-0 flex flex-col items-end gap-1">
                      <p className="text-base font-bold tabular-nums">&euro;{Number(order.totalAmount).toFixed(2)}</p>
                      {isWaiting && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                          <CreditCard className="h-3 w-3" />
                          {locale === 'ar' ? 'أكمل الدفع' : locale === 'en' ? 'Complete payment' : 'Zahlung fortsetzen'}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>

          {currentQuery.hasNextPage && (
            <div className="mt-6 flex justify-center">
              <Button
                variant="outline"
                onClick={() => currentQuery.fetchNextPage()}
                disabled={currentQuery.isFetchingNextPage}
              >
                {currentQuery.isFetchingNextPage ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {t('orders.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
