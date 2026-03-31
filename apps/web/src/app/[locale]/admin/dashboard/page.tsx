'use client'

import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import { formatCurrency } from '@/lib/locale-utils'
import {
  TrendingUp, TrendingDown, Package,
  RotateCcw, Plus, Search, Printer, ArrowUpRight,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth-store'
import { Button } from '@/components/ui/button'

function hasPerm(user: any, p: string): boolean {
  if (!user) return false
  if (user.role === 'super_admin') return true
  const perms: string[] = Array.isArray(user.permissions) ? user.permissions : []
  return perms.includes(p)
}

// Lazy load charts (only on dashboard)
const RevenueChart = dynamic(() => import('@/components/admin/revenue-chart').then((m) => m.RevenueChart), {
  loading: () => <div className="h-64 animate-pulse bg-muted rounded-lg" />,
})
const PaymentPieChart = dynamic(() => import('@/components/admin/payment-pie-chart').then((m) => m.PaymentPieChart), {
  loading: () => <div className="h-64 animate-pulse bg-muted rounded-lg" />,
})

export default function AdminDashboard() {
  const locale = useLocale()
  const t = useTranslations('admin')
  const adminUser = useAuthStore((s) => s.adminUser)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: async () => {
      const { data } = await api.get('/admin/dashboard')
      return data
    },
    refetchInterval: 30000,
  })

  const canRevenue = hasPerm(adminUser, 'finance.revenue')
  const canOrders = hasPerm(adminUser, 'orders.view')
  const canProducts = hasPerm(adminUser, 'products.view')
  const canInventory = hasPerm(adminUser, 'inventory.view')
  const canShipping = hasPerm(adminUser, 'shipping.view')

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-28 animate-pulse bg-muted rounded-xl" />)}
        </div>
        <div className="h-72 animate-pulse bg-muted rounded-xl" />
      </div>
    )
  }

  const today = data?.today ?? {}
  const openOrders = data?.ordersByStatus
    ?.filter((s: any) => ['pending', 'confirmed', 'processing'].includes(s.status))
    .reduce((sum: number, s: any) => sum + s.count, 0) ?? 0
  const disputes = data?.disputes?.count ?? 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>
        <p className="text-sm text-muted-foreground">{new Date().toLocaleDateString(locale === 'ar' ? 'ar-EG-u-nu-latn' : locale === 'de' ? 'de-DE' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>

      {/* Quick Actions — only show relevant ones */}
      <div className="flex flex-wrap gap-2">
        {canProducts && <Link href={`/${locale}/admin/products/new`}><Button size="sm" variant="outline" className="gap-1.5"><Plus className="h-3.5 w-3.5" />{t('dashboard.newProduct')}</Button></Link>}
        {canOrders && <Button size="sm" variant="outline" className="gap-1.5"><Search className="h-3.5 w-3.5" />{t('dashboard.searchOrder')}</Button>}
        {canInventory && <Link href={`/${locale}/admin/inventory`}><Button size="sm" variant="outline" className="gap-1.5"><Package className="h-3.5 w-3.5" />{t('dashboard.restockInventory')}</Button></Link>}
        {canShipping && <Link href={`/${locale}/admin/orders?status=confirmed`}><Button size="sm" variant="outline" className="gap-1.5"><Printer className="h-3.5 w-3.5" />{t('dashboard.printLabels')}</Button></Link>}
      </div>

      {/* KPI Cards — filtered by permission */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {canRevenue && (
          <KpiCard
            title={t('dashboard.revenueToday')}
            value={`€${today.revenueGross ?? '0.00'}`}
            subtitle={`${t('dashboard.net')}: €${today.revenueNet ?? '0.00'}`}
            trend={data?.thisMonth?.monthOverMonth}
          />
        )}
        {canOrders && (
          <KpiCard
            title={t('dashboard.ordersToday')}
            value={today.orderCount ?? 0}
            subtitle={`${t('dashboard.avg')}: ${today.avgOrderValue ?? '0.00'} €`}
          />
        )}
        {canOrders && (
          <KpiCard
            title={t('dashboard.openOrders')}
            value={openOrders}
            subtitle={t('dashboard.pendingConfirmedProcessing')}
            href={`/${locale}/admin/orders?status=pending`}
          />
        )}
        {canInventory && !canOrders && (
          <KpiCard
            title={t('dashboard.lowStock')}
            value={(data?.lowStock ?? []).length}
            subtitle={locale === 'ar' ? 'منتجات بمخزون منخفض' : 'Produkte mit niedrigem Bestand'}
            href={`/${locale}/admin/inventory`}
          />
        )}
        {canRevenue && (
          <KpiCard
            title={t('dashboard.openDisputes')}
            value={disputes}
            subtitle={disputes > 0 ? `€${data?.disputes?.totalAmount ?? '0.00'}` : t('dashboard.noDisputes')}
            alert={disputes > 0}
          />
        )}
      </div>

      {/* Charts Row — only for finance permission */}
      {canRevenue && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-background border rounded-xl p-5">
            <h3 className="font-semibold mb-4">{t('dashboard.revenueWeek')}</h3>
            <RevenueChart />
          </div>
          <div className="bg-background border rounded-xl p-5">
            <h3 className="font-semibold mb-4">{t('dashboard.paymentMethods')}</h3>
            <PaymentPieChart data={data?.revenueByPaymentMethod ?? []} />
          </div>
        </div>
      )}

      {/* Bottom Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Products — only with revenue permission */}
        {canRevenue && <div className="bg-background border rounded-xl p-5">
          <h3 className="font-semibold mb-4">{t('dashboard.topProducts')}</h3>
          <div className="space-y-2">
            {(data?.topProducts ?? []).slice(0, 10).map((p: any, i: number) => (
              <div key={i} className="flex items-center gap-3 text-sm py-2 border-b last:border-b-0">
                <span className="text-muted-foreground w-5 text-xs">{i + 1}</span>
                <div className="h-9 w-9 rounded-lg bg-muted overflow-hidden flex-shrink-0">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[8px] text-muted-foreground">{(p.name ?? '?').charAt(0)}</div>
                  )}
                </div>
                <span className="flex-1 truncate font-medium">{p.name ?? '—'}</span>
                <div className="text-right flex-shrink-0">
                  <span className="font-semibold">{formatCurrency(Number(p.revenue ?? 0), locale)}</span>
                  <span className="text-xs text-muted-foreground ml-1.5">{Number(p.quantity ?? 0)}×</span>
                </div>
              </div>
            ))}
            {(data?.topProducts ?? []).length === 0 && <p className="text-sm text-muted-foreground">{t('dashboard.noData')}</p>}
          </div>
        </div>}

        {/* Low Stock — visible for inventory permission */}
        {canInventory && <div className="bg-background border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">{t('dashboard.lowStock')}</h3>
            <Link href={`/${locale}/admin/inventory?lowStockOnly=true`} className="text-xs text-primary hover:underline">
              {t('dashboard.viewAll')}
            </Link>
          </div>
          <div className="space-y-2">
            {(data?.lowStock ?? []).slice(0, 8).map((item: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b last:border-b-0">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{item.sku}</p>
                  <p className="text-xs text-muted-foreground truncate">{item.product} — {item.warehouse}</p>
                </div>
                <span className={`font-bold text-xs px-2 py-0.5 rounded-full ${
                  item.available <= 0 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                }`}>
                  {item.available} {t('dashboard.available')}
                </span>
              </div>
            ))}
            {(data?.lowStock ?? []).length === 0 && <p className="text-sm text-muted-foreground">{t('dashboard.allStockOk')}</p>}
          </div>
        </div>}
      </div>

      {/* Live Feeds */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Orders — only with orders permission */}
        {canOrders && <div className="bg-background border rounded-xl p-5">
          <h3 className="font-semibold mb-4">{t('dashboard.recentOrders')}</h3>
          <div className="space-y-2">
            {(data?.recentOrders ?? []).map((order: any) => (
              <Link
                key={order.id}
                href={`/${locale}/admin/orders/${order.id}`}
                className="flex items-center justify-between text-sm py-2 border-b last:border-b-0 hover:bg-muted/50 -mx-2 px-2 rounded transition-colors"
              >
                <div>
                  <span className="font-mono font-medium text-xs">{order.orderNumber}</span>
                  <span className="text-muted-foreground text-xs ml-2">{order.user?.firstName} {order.user?.lastName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{formatCurrency(Number(order.totalAmount), locale)}</span>
                  <ArrowUpRight className="h-3 w-3 text-muted-foreground" />
                </div>
              </Link>
            ))}
          </div>
        </div>}

        {/* Recent Audit Actions — only for audit permission */}
        {hasPerm(adminUser, 'audit.view') && (
          <div className="bg-background border rounded-xl p-5">
            <h3 className="font-semibold mb-4">{t('dashboard.recentActions')}</h3>
            <div className="space-y-2">
              {(data?.recentAuditActions ?? []).map((action: any) => (
                <div key={action.id} className="text-sm py-2 border-b last:border-b-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-xs">{action.action}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(action.createdAt).toLocaleTimeString(locale === 'ar' ? 'ar-EG-u-nu-latn' : locale === 'de' ? 'de-DE' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {action.entityType}:{action.entityId?.slice(0, 8)} — IP: {action.ipAddress ?? '—'}
                  </p>
                </div>
              ))}
              {(data?.recentAuditActions ?? []).length === 0 && <p className="text-sm text-muted-foreground">{t('dashboard.noData')}</p>}
            </div>
          </div>
        )}
      </div>

      {/* Pending Returns — only for returns permission */}
      {hasPerm(adminUser, 'returns.view') && (data?.pendingReturns?.count ?? 0) > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <RotateCcw className="h-5 w-5 text-orange-600" />
            <h3 className="font-semibold text-orange-800">{data.pendingReturns.count} {t('dashboard.openReturns')}</h3>
          </div>
          <div className="space-y-1">
            {data.pendingReturns.items.slice(0, 5).map((ret: any) => (
              <p key={ret.id} className="text-sm text-orange-700">
                {ret.order?.orderNumber} — Status: {ret.status}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function KpiCard({ title, value, subtitle, trend, alert, href }: {
  title: string; value: string | number; subtitle?: string; trend?: string; alert?: boolean; href?: string
}) {
  const Wrapper = href ? Link : 'div'
  return (
    <Wrapper href={href ?? ''} className={`bg-background border rounded-xl p-5 ${alert ? 'border-destructive bg-destructive/5' : ''} ${href ? 'hover:border-foreground/20 transition-colors' : ''}`}>
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className={`text-2xl font-bold mt-1 ${alert ? 'text-destructive' : ''}`}>{value}</p>
      <div className="flex items-center gap-1.5 mt-1">
        {trend && (
          <span className={`text-xs font-medium flex items-center gap-0.5 ${
            trend.startsWith('+') ? 'text-green-600' : 'text-red-600'
          }`}>
            {trend.startsWith('+') ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {trend}
          </span>
        )}
        {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
      </div>
    </Wrapper>
  )
}
