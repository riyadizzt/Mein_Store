'use client'

import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Package, Loader2 } from 'lucide-react'
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

export default function OrdersPage() {
  const locale = useLocale()
  const t = useTranslations('account')

  const { data, isLoading, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['my-orders'],
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get('/users/me/orders', {
        params: { cursor: pageParam, limit: 10 },
      })
      return data
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: any) => lastPage.nextCursor,
  })

  const orders = data?.pages.flatMap((p: any) => p.items ?? p.data ?? []) ?? []

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse bg-muted rounded-lg" />)}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="text-center py-16">
        <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
          <Package className="h-6 w-6 text-destructive" />
        </div>
        <h2 className="text-lg font-medium mb-2">{locale === 'ar' ? 'حدث خطأ في تحميل الطلبات' : locale === 'en' ? 'Failed to load orders' : 'Fehler beim Laden der Bestellungen'}</h2>
        <p className="text-sm text-muted-foreground mb-4">{locale === 'ar' ? 'يرجى المحاولة مرة أخرى' : locale === 'en' ? 'Please try again' : 'Bitte versuche es erneut'}</p>
        <Button variant="outline" onClick={() => refetch()}>{locale === 'ar' ? 'إعادة المحاولة' : locale === 'en' ? 'Retry' : 'Erneut versuchen'}</Button>
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <div className="text-center py-16">
        <Package className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
        <h2 className="text-lg font-medium mb-2">{t('orders.empty')}</h2>
        <Link href={`/${locale}/products`}>
          <Button variant="outline">{t('orders.shopNow')}</Button>
        </Link>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-6">{t('orders.title')}</h2>
      <div className="space-y-3">
        {orders.map((order: any) => {
          const statusColor = STATUS_COLORS[order.status] ?? 'bg-gray-100'
          const statusLabel = t(`orderStatus.${order.status}` as any, { defaultValue: order.status })
          return (
            <Link
              key={order.id}
              href={`/${locale}/account/orders/${order.orderNumber}`}
              className="block border rounded-2xl p-4 shadow-card hover:shadow-card-hover transition-all"
            >
              <div className="flex items-center gap-4">
                {/* Product Thumbnails */}
                <div className="flex -space-x-2 flex-shrink-0">
                  {(order.items ?? []).slice(0, 3).map((item: any, idx: number) => (
                    <div key={idx} className="h-12 w-12 rounded-xl bg-muted border-2 border-background overflow-hidden">
                      {item.variant?.product?.images?.[0]?.url ? (
                        <img src={item.variant.product.images[0].url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[8px] text-muted-foreground">{item.snapshotSku?.slice(0, 3)}</div>
                      )}
                    </div>
                  ))}
                  {(order.items ?? []).length > 3 && (
                    <div className="h-12 w-12 rounded-xl bg-muted border-2 border-background flex items-center justify-center text-xs text-muted-foreground font-medium">
                      +{(order.items ?? []).length - 3}
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="font-mono font-semibold text-sm">{order.orderNumber}</p>
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${statusColor}`}>
                      {statusLabel}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(order.createdAt).toLocaleDateString(locale === 'ar' ? 'ar-EG-u-nu-latn' : locale === 'en' ? 'en-GB' : 'de-DE')} &middot; {t('orders.itemCount', { count: (order.items ?? []).length })}
                  </p>
                </div>

                {/* Price */}
                <p className="text-base font-bold flex-shrink-0">&euro;{Number(order.totalAmount).toFixed(2)}</p>
              </div>
            </Link>
          )
        })}
      </div>

      {hasNextPage && (
        <div className="mt-6 flex justify-center">
          <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {t('orders.loadMore')}
          </Button>
        </div>
      )}
    </div>
  )
}
