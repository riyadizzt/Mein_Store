'use client'

import { useLocale } from 'next-intl'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import { formatCurrency } from '@/lib/locale-utils'
import {
  Euro, ShoppingBag, BarChart3, Package, ArrowUpRight,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth-store'
import { KpiCard } from './kpi-card'
import { TasksWidget } from './tasks-widget'
import { ActivityTimeline } from './activity-timeline'
import { ChannelDonut } from './channel-donut'
import { ChannelIcon } from '@/components/admin/channel-icon'

const RevenueChart = dynamic(() => import('@/components/admin/revenue-chart').then((m) => m.RevenueChart), {
  loading: () => <div className="h-64 animate-pulse bg-muted rounded-xl" />,
})

function hasPerm(user: any, p: string): boolean {
  if (!user) return false
  if (user.role === 'super_admin') return true
  return (Array.isArray(user.permissions) ? user.permissions : []).includes(p)
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300',
  pending_payment: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300',
  confirmed: 'bg-blue-500/20 text-blue-700 dark:text-blue-300',
  processing: 'bg-blue-500/20 text-blue-700 dark:text-blue-300',
  shipped: 'bg-purple-500/20 text-purple-700 dark:text-purple-300',
  delivered: 'bg-green-500/20 text-green-700 dark:text-green-300',
  cancelled: 'bg-gray-500/20 text-gray-600 dark:text-gray-400',
  returned: 'bg-orange-500/20 text-orange-700 dark:text-orange-300',
  refunded: 'bg-orange-500/20 text-orange-700 dark:text-orange-300',
  disputed: 'bg-red-500/20 text-red-700 dark:text-red-300',
}
const STATUS_FALLBACK = 'bg-gray-500/20 text-gray-600 dark:text-gray-400'

const STATUS_LABELS: Record<string, { de: string; en: string; ar: string }> = {
  pending: { de: 'Ausstehend', en: 'Pending', ar: 'معلق' },
  pending_payment: { de: 'Zahlung offen', en: 'Payment pending', ar: 'بانتظار الدفع' },
  confirmed: { de: 'Bestätigt', en: 'Confirmed', ar: 'مؤكد' },
  processing: { de: 'In Bearbeitung', en: 'Processing', ar: 'قيد المعالجة' },
  shipped: { de: 'Versendet', en: 'Shipped', ar: 'تم الشحن' },
  delivered: { de: 'Geliefert', en: 'Delivered', ar: 'تم التسليم' },
  cancelled: { de: 'Storniert', en: 'Cancelled', ar: 'ملغي' },
  returned: { de: 'Retourniert', en: 'Returned', ar: 'مرتجع' },
  refunded: { de: 'Erstattet', en: 'Refunded', ar: 'مسترد' },
  disputed: { de: 'Streitfall', en: 'Disputed', ar: 'متنازع' },
}

export function DashboardV2() {
  const locale = useLocale()
  const adminUser = useAuthStore((s) => s.adminUser)
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  const { data, isLoading } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: async () => { const { data } = await api.get('/admin/dashboard'); return data },
    refetchInterval: 30000,
  })

  const canRevenue = hasPerm(adminUser, 'finance.revenue')
  const canOrders = hasPerm(adminUser, 'orders.view')
  const canInventory = hasPerm(adminUser, 'inventory.view')

  // Skeleton
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-28 animate-pulse bg-muted rounded-2xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-80 animate-pulse bg-muted rounded-2xl" />
          <div className="h-80 animate-pulse bg-muted rounded-2xl" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => <div key={i} className="h-64 animate-pulse bg-muted rounded-2xl" />)}
        </div>
      </div>
    )
  }

  const today = data?.today ?? {}
  const cancRate = data?.cancellationRate

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t3('Dashboard', 'Dashboard', 'لوحة التحكم')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString(locale === 'ar' ? 'ar-EG-u-nu-latn' : locale === 'de' ? 'de-DE' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </div>

      {/* ═══════ ROW 1 — KPI Cards ═══════ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {canRevenue && (
          <KpiCard
            title={t3('Umsatz heute', 'Revenue Today', 'إيرادات اليوم')}
            value={Number(today.revenueGross ?? 0)}
            prefix="€"
            trend={data?.thisMonth?.monthOverMonth}
            subtitle={t3('Monat vs. Vormonat', 'Month vs. previous', 'الشهر مقارنة بالسابق')}
            icon={<Euro className="h-5 w-5" />}
            accentColor="#d4a853"
            delay={0}
            href={`/${locale}/admin/finance`}
          />
        )}
        {canOrders && (
          <KpiCard
            title={t3('Bestellungen heute', 'Orders Today', 'طلبات اليوم')}
            value={today.orderCount ?? 0}
            subtitle={`${t3('Ø', 'Avg', 'متوسط')} ${today.avgOrderValue ?? '0.00'} €`}
            icon={<ShoppingBag className="h-5 w-5" />}
            accentColor="#3b82f6"
            delay={100}
            href={`/${locale}/admin/orders`}
          />
        )}
        <KpiCard
          title={t3('Stornoquote', 'Cancellation Rate', 'نسبة الإلغاء')}
          value={Number(cancRate?.rate ?? 0)}
          suffix="%"
          subtitle={`${cancRate?.cancelled ?? 0}/${cancRate?.total ?? 0} (30 ${t3('Tage', 'days', 'يوم')})`}
          icon={<BarChart3 className="h-5 w-5" />}
          accentColor="#8b5cf6"
          alert={Number(cancRate?.rate ?? 0) > 10}
          delay={200}
        />
        {canOrders && (
          <KpiCard
            title={t3('Offene Aufgaben', 'Open Tasks', 'مهام مفتوحة')}
            value={
              (data?.ordersByStatus?.filter((s: any) => ['pending', 'confirmed', 'processing'].includes(s.status)).reduce((sum: number, s: any) => sum + s.count, 0) ?? 0)
              + (data?.pendingReturns?.count ?? 0)
              + (data?.disputes?.count ?? 0)
            }
            subtitle={t3('Versand + Retouren + Streitfälle', 'Shipping + Returns + Disputes', 'شحن + مرتجعات + نزاعات')}
            icon={<Package className="h-5 w-5" />}
            accentColor="#10b981"
            delay={300}
          />
        )}
      </div>

      {/* ═══════ ROW 2 — Chart + Channel Donut ═══════ */}
      {canRevenue && (
        <div className="grid grid-cols-1 lg:grid-cols-10 gap-6">
          {/* Revenue Chart — 70% */}
          <div className="lg:col-span-7 bg-background border rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm">{t3('Umsatz — Letzte 7 Tage', 'Revenue — Last 7 Days', 'الإيرادات — آخر 7 أيام')}</h3>
            </div>
            <RevenueChart />
          </div>
          {/* Channel Donut — 30% */}
          <div className="lg:col-span-3 bg-background border rounded-2xl p-5">
            <h3 className="font-semibold text-sm mb-3">{t3('Kanäle heute', 'Channels Today', 'القنوات اليوم')}</h3>
            <ChannelDonut data={data?.todayByChannel ?? []} locale={locale} />
          </div>
        </div>
      )}

      {/* ═══════ ROW 3 — Top Products + Tasks + Activity ═══════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top 10 Products */}
        {canRevenue && (
          <div className="bg-background border border-border/60 rounded-2xl p-5 shadow-sm">
            {/* Header with gold accent bar (consistent with tasks + activity) */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <span className="h-4 w-1 rounded-full bg-[#d4a853]" aria-hidden="true" />
                <h3 className="font-semibold text-[15px] tracking-tight">
                  {t3('Top 10 Produkte', 'Top 10 Products', 'أفضل 10 منتجات')}
                </h3>
              </div>
              <Link
                href={`/${locale}/admin/finance`}
                className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {t3('Mehr', 'More', 'المزيد')} <span className="rtl:hidden">→</span><span className="ltr:hidden">←</span>
              </Link>
            </div>

            {(data?.topProducts ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-10 text-center">
                {t3('Keine Daten', 'No data', 'لا توجد بيانات')}
              </p>
            ) : (
              <div className="-mx-2">
                {(data?.topProducts ?? []).slice(0, 10).map((p: any, i: number) => {
                  const rank = i + 1
                  // Medal styling for top 3, neutral pill for 4-10
                  const rankStyles =
                    rank === 1
                      ? 'bg-[#d4a853] text-white ring-[#d4a853]/30'
                      : rank === 2
                      ? 'bg-slate-200 text-slate-700 ring-slate-300/60 dark:bg-slate-500/30 dark:text-slate-200 dark:ring-slate-400/30'
                      : rank === 3
                      ? 'bg-amber-700/90 text-white ring-amber-700/30'
                      : 'bg-muted text-muted-foreground ring-border/40'
                  return (
                    <div
                      key={i}
                      className="group flex items-center gap-3 px-2 py-2.5 rounded-xl transition-colors duration-150 hover:bg-muted/40"
                    >
                      {/* Rank badge — medal colors for top 3.
                          Glyph wrapped in leading-none span so flex centers
                          the actual number, not the font's line-height box. */}
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ring-1 ${rankStyles}`}
                      >
                        <span className="text-[11px] font-bold leading-none">{rank}</span>
                      </div>

                      {/* Product thumbnail */}
                      <div className="h-10 w-10 rounded-xl bg-muted overflow-hidden flex-shrink-0 ring-1 ring-border/40">
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground font-bold">
                            {(p.name ?? '?')[0]}
                          </div>
                        )}
                      </div>

                      {/* Name + qty badge */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-foreground/90 truncate leading-tight">
                          {p.name ?? '—'}
                        </p>
                        <p className="text-[11px] text-muted-foreground/70 tabular-nums mt-0.5">
                          {Number(p.quantity ?? 0)}× {t3('verkauft', 'sold', 'مبيع')}
                        </p>
                      </div>

                      {/* Revenue — prominent, tabular */}
                      <div className="text-end flex-shrink-0">
                        <p className="text-sm font-bold tabular-nums text-foreground">
                          {formatCurrency(Number(p.revenue ?? 0), locale)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Open Tasks */}
        <TasksWidget data={data} locale={locale} />

        {/* Activity Timeline */}
        <ActivityTimeline actions={data?.recentAuditActions ?? []} locale={locale} />
      </div>

      {/* ═══════ ROW 4 — Recent Orders + Low Stock ═══════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Orders */}
        {canOrders && (
          <div className="bg-background border rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm">{t3('Letzte Bestellungen', 'Recent Orders', 'آخر الطلبات')}</h3>
              <Link href={`/${locale}/admin/orders`} className="text-[10px] text-muted-foreground hover:text-foreground">{t3('Alle anzeigen', 'View all', 'عرض الكل')} →</Link>
            </div>
            <div className="space-y-0">
              {(data?.recentOrders ?? []).slice(0, 10).map((order: any) => (
                <Link key={order.id} href={`/${locale}/admin/orders/${order.id}`}
                  className="flex items-center gap-3 py-2.5 border-b last:border-b-0 hover:bg-muted/30 -mx-2 px-2 rounded-lg transition-colors">
                  <div className="flex-shrink-0"><ChannelIcon channel={order.channel ?? 'website'} size={16} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-medium">{order.orderNumber}</span>
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${STATUS_COLORS[order.status] ?? STATUS_FALLBACK}`}>{STATUS_LABELS[order.status] ? (locale === 'ar' ? STATUS_LABELS[order.status].ar : locale === 'en' ? STATUS_LABELS[order.status].en : STATUS_LABELS[order.status].de) : order.status}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {order.user ? `${order.user.firstName} ${order.user.lastName ?? ''}`.trim() : (order.guestEmail ?? t3('Gast', 'Guest', 'ضيف'))}
                    </p>
                  </div>
                  <div className="text-end flex-shrink-0">
                    <p className="text-xs font-bold tabular-nums">{formatCurrency(Number(order.totalAmount), locale)}</p>
                  </div>
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/40 flex-shrink-0 rtl:-scale-x-100" />
                </Link>
              ))}
              {(data?.recentOrders ?? []).length === 0 && <p className="text-xs text-muted-foreground py-6 text-center">{t3('Keine Bestellungen', 'No orders', 'لا توجد طلبات')}</p>}
            </div>
          </div>
        )}

        {/* Low Stock */}
        {canInventory && (
          <div className="bg-background border rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm">{t3('Niedrige Bestände', 'Low Stock', 'مخزون منخفض')}</h3>
              <Link href={`/${locale}/admin/inventory`} className="text-[10px] text-muted-foreground hover:text-foreground">{t3('Alle anzeigen', 'View all', 'عرض الكل')} →</Link>
            </div>
            <div className="space-y-0">
              {(data?.lowStock ?? []).slice(0, 8).map((item: any, i: number) => (
                <div key={i} className="flex items-center gap-3 py-2.5 border-b last:border-b-0">
                  <div className="h-8 w-8 rounded-lg bg-muted overflow-hidden flex-shrink-0">
                    {item.imageUrl
                      ? <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center"><Package className="h-4 w-4 text-muted-foreground/30" /></div>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{item.product}</p>
                    <p className="text-[10px] text-muted-foreground">{item.sku} — {item.warehouse}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full tabular-nums ${
                      item.available <= 0 ? 'bg-red-500/20 text-red-600' : 'bg-amber-500/20 text-amber-600'
                    }`}>
                      {item.available}
                    </span>
                    <Link href={`/${locale}/admin/suppliers/receiving`} className="text-[10px] text-primary hover:underline whitespace-nowrap">
                      {t3('Nachbestellen', 'Reorder', 'إعادة طلب')}
                    </Link>
                  </div>
                </div>
              ))}
              {(data?.lowStock ?? []).length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center mb-2">
                    <svg className="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <p className="text-xs text-muted-foreground">{t3('Bestand OK', 'Stock OK', 'المخزون جيد')}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
