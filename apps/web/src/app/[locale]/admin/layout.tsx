'use client'

import { useEffect, useState, lazy, Suspense } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutDashboard, Package, ShoppingBag, Users, Warehouse, Tag,
  MapPin, ScrollText, Menu, X, Bell, LogOut, Globe,
  RotateCcw, Truck, Settings, Users2, Mail, Palette, FileText,
  ScanBarcode,
} from 'lucide-react'
import { useAuthStore } from '@/store/auth-store'
import { api } from '@/lib/api'
import { Camera } from 'lucide-react'

const CameraBarcodeScannerOverlay = lazy(() => import('@/components/admin/camera-barcode-scanner').then((m) => ({ default: m.CameraBarcodeScannerOverlay })))

const NAV_GROUPS = [
  {
    label: { de: 'Hauptmenü', en: 'Main', ar: 'الرئيسية' },
    items: [
      { key: 'dashboard', labelKey: 'dashboard', href: '/admin/dashboard', icon: LayoutDashboard, permission: 'dashboard.view' },
      { key: 'orders', labelKey: 'orders', href: '/admin/orders', icon: ShoppingBag, badgeKey: 'openOrders', permission: 'orders.view' },
      { key: 'customers', labelKey: 'users', href: '/admin/customers', icon: Users, permission: 'customers.view' },
    ],
  },
  {
    label: { de: 'Katalog', en: 'Catalog', ar: 'الكتالوج' },
    items: [
      { key: 'products', labelKey: 'products', href: '/admin/products', icon: Package, permission: 'products.view' },
      { key: 'categories', labelKey: 'categories', href: '/admin/categories', icon: Tag, permission: 'categories.view' },
      { key: 'inventory', labelKey: 'inventory', href: '/admin/inventory', icon: Warehouse, badgeKey: 'lowStock', permission: 'inventory.view' },
    ],
  },
  {
    label: { de: 'Fulfillment', en: 'Fulfillment', ar: 'التنفيذ' },
    items: [
      { key: 'shipping-zones', labelKey: 'shippingZones', href: '/admin/shipping-zones', icon: MapPin, permission: 'settings.view' },
      { key: 'returns', labelKey: 'returns', href: '/admin/returns', icon: RotateCcw, permission: 'returns.view' },
      { key: 'shipments', labelKey: 'shipments', href: '/admin/shipments', icon: Truck, permission: 'shipping.view' },
    ],
  },
  {
    label: { de: 'Einstellungen', en: 'Settings', ar: 'الإعدادات' },
    items: [
      { key: 'settings', labelKey: 'settings', href: '/admin/settings', icon: Settings, permission: 'settings.view' },
      { key: 'appearance', labelKey: 'appearance', href: '/admin/settings/appearance', icon: Palette, permission: 'settings.edit' },
      { key: 'pages', labelKey: 'pages', href: '/admin/pages', icon: FileText, permission: 'settings.edit' },
      { key: 'staff', labelKey: 'staff', href: '/admin/staff', icon: Users2, permission: 'staff.view' },
      { key: 'emails', labelKey: 'emails', href: '/admin/emails', icon: Mail, permission: 'emails.view' },
      { key: 'audit-log', labelKey: 'auditLog', href: '/admin/audit-log', icon: ScrollText, permission: 'audit.view' },
    ],
  },
]

// hasPermission used inside render

// Check if user has a specific permission
function hasPermission(user: any, permission: string): boolean {
  if (!user) return false
  if (user.role === 'super_admin') return true
  const perms: string[] = Array.isArray(user.permissions) ? user.permissions : []
  return perms.includes(permission)
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const locale = useLocale()
  const t = useTranslations('admin')
  const router = useRouter()
  const pathname = usePathname()
  const { adminUser: user, isAdminAuthenticated: isAuthenticated, adminLogout: logout } = useAuthStore()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [cameraScannerOpen, setCameraScannerOpen] = useState(false)

  // Skip auth guard on login page
  const isLoginPage = pathname.includes('/admin/login')

  // Auth guard (skip for login page)
  useEffect(() => {
    if (!isLoginPage && (!isAuthenticated || !['admin', 'super_admin', 'warehouse_staff'].includes(user?.role ?? ''))) {
      router.push(`/${locale}/admin/login`)
    }
  }, [isAuthenticated, user, router, locale, isLoginPage])

  // Notifications polling
  const { data: notifications } = useQuery({
    queryKey: ['admin-notifications'],
    queryFn: async () => {
      const { data } = await api.get('/admin/dashboard')
      return {
        openOrders: data?.ordersByStatus
          ?.filter((s: any) => ['pending', 'confirmed', 'processing'].includes(s.status))
          .reduce((sum: number, s: any) => sum + s.count, 0) ?? 0,
        lowStock: data?.lowStock?.length ?? 0,
        disputes: data?.disputes?.count ?? 0,
        pendingReturns: data?.pendingReturns?.count ?? 0,
      }
    },
    refetchInterval: 30000,
    enabled: isAuthenticated,
  })

  const totalNotifications = (notifications?.disputes ?? 0) + (notifications?.pendingReturns ?? 0)

  // Login page: render children directly without admin layout
  if (isLoginPage) {
    return <>{children}</>
  }

  // Not authenticated: show nothing (redirect is happening via useEffect)
  if (!isAuthenticated || !['admin', 'super_admin', 'warehouse_staff'].includes(user?.role ?? '')) return null

  const isActive = (href: string) => pathname.includes(href)

  const handleLogout = () => {
    logout()
    router.push(`/${locale}/admin/login`)
  }

  const switchLocale = () => {
    const newLocale = locale === 'de' ? 'ar' : 'de'
    const segments = pathname.split('/')
    segments[1] = newLocale
    router.push(segments.join('/'))
  }

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Mobile Header */}
      <div className="lg:hidden sticky top-0 z-50 bg-background border-b h-14 flex items-center justify-between px-4">
        <button onClick={() => setSidebarOpen(true)}>
          <Menu className="h-5 w-5" />
        </button>
        <span className="font-bold">MALAK Admin</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setCameraScannerOpen(true)} className="p-2 rounded-lg hover:bg-muted active:scale-95 transition-all" aria-label="Camera Scanner">
            <Camera className="h-5 w-5" />
          </button>
          <NotificationBell count={totalNotifications} locale={locale} />
        </div>
      </div>

      {/* Camera Scanner Overlay (mobile) */}
      {cameraScannerOpen && (
        <Suspense fallback={null}>
          <CameraBarcodeScannerOverlay mode="single" locale={locale} onClose={() => setCameraScannerOpen(false)} />
        </Suspense>
      )}

      <div className="flex">
        {/* Sidebar */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-50 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
        )}
        <aside className={`fixed top-0 z-50 h-full w-64 bg-[#1a1a2e] text-white transition-transform lg:!translate-x-0 lg:static lg:z-auto ${
          sidebarOpen ? 'translate-x-0' : 'ltr:-translate-x-full rtl:translate-x-full'
        } ltr:left-0 rtl:right-0`}>
          {/* Sidebar uses flex-col so footer doesn't overlap */}
          <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="h-16 flex items-center justify-between px-5 flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#d4a853] to-[#b8922e] flex items-center justify-center shadow-lg shadow-[#d4a853]/20">
                <span className="text-white font-black text-sm">M</span>
              </div>
              <div>
                <span className="font-bold text-sm tracking-tight text-white">MALAK</span>
                <span className="block text-[9px] text-white/30 -mt-0.5 tracking-widest uppercase">Admin</span>
              </div>
            </div>
            <button className="lg:hidden p-1 hover:bg-white/10 rounded-lg" onClick={() => setSidebarOpen(false)}>
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Nav — scrollable with groups */}
          <nav className="flex-1 px-3 pb-3 overflow-y-auto space-y-4">
            {NAV_GROUPS.map((group) => {
              const visibleItems = group.items.filter((item) => hasPermission(user, item.permission))
              if (visibleItems.length === 0) return null
              return (
                <div key={group.label.en}>
                  <div className="px-3 mb-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/25">
                      {(group.label as any)[locale] || group.label.de}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {visibleItems.map((item) => {
                      const active = isActive(item.href)
                      const badge = item.badgeKey ? (notifications as any)?.[item.badgeKey] : 0
                      return (
                        <Link
                          key={item.key}
                          href={`/${locale}${item.href}`}
                          onClick={() => setSidebarOpen(false)}
                          className={`flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] transition-all group relative ${
                            active
                              ? 'bg-[#d4a853]/15 text-[#d4a853] font-semibold'
                              : 'text-white/50 hover:text-white hover:bg-white/5'
                          }`}
                        >
                          {active && <div className="absolute ltr:left-0 rtl:right-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full bg-[#d4a853]" />}
                          <item.icon className={`h-[18px] w-[18px] transition-colors ${active ? 'text-[#d4a853]' : 'text-white/30 group-hover:text-white/60'}`} />
                          <span className="flex-1">{t(`nav.${item.labelKey}`)}</span>
                          {badge > 0 && (
                            <span className={`h-5 min-w-[20px] rounded-full text-[10px] font-bold flex items-center justify-center px-1.5 ${
                              active ? 'bg-[#d4a853] text-white' : 'bg-red-500 text-white'
                            }`}>
                              {badge}
                            </span>
                          )}
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </nav>

          {/* User section */}
          <div className="p-3 border-t border-white/[0.06] flex-shrink-0">
            <div className="flex items-center gap-2.5 px-2 py-2 mb-2">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-white/15 to-white/5 flex items-center justify-center text-xs font-bold text-white/70">
                {user?.firstName?.[0]}{user?.lastName?.[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-white/80 truncate">{user?.firstName} {user?.lastName}</div>
                <div className="text-[10px] text-white/30">{user?.role === 'super_admin' ? 'Super Admin' : user?.staffRole || user?.role}</div>
              </div>
            </div>
            <div className="flex gap-1.5">
              <button onClick={switchLocale} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-[11px] text-white/40 hover:text-white/60 transition-colors">
                <Globe className="h-3 w-3" />
                {locale === 'de' ? 'العربية' : 'Deutsch'}
              </button>
              <button onClick={handleLogout} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-red-500/20 text-[11px] text-white/40 hover:text-red-400 transition-colors">
                <LogOut className="h-3 w-3" />
                {t('nav.logout')}
              </button>
            </div>
          </div>
          </div>{/* close flex-col container */}
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-h-screen">
          {/* Desktop Header */}
          <div className="hidden lg:flex h-14 bg-background border-b items-center justify-end px-6 gap-4">
            {/* Scanner Field */}
            <div className="relative flex-1 max-w-xs">
              <ScanBarcode className="absolute left-3 rtl:left-auto rtl:right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                placeholder={locale === 'ar' ? 'مسح الباركود...' : 'Barcode scannen...'}
                className="w-full h-9 pl-10 rtl:pl-3 rtl:pr-10 rounded-xl border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const code = (e.target as HTMLInputElement).value.trim()
                    if (code) {
                      router.push(`/${locale}/admin/inventory?search=${encodeURIComponent(code)}`)
                      ;(e.target as HTMLInputElement).value = ''
                    }
                  }
                }}
              />
            </div>
            <NotificationBell count={totalNotifications} locale={locale} />
            <span className="text-sm text-muted-foreground">
              {user?.firstName} <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted uppercase">{user?.role}</span>
            </span>
          </div>
          <div className="p-4 sm:p-6 lg:p-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}

function NotificationBell({ locale }: { count: number; locale: string }) {
  const t = useTranslations('admin')
  const navRouter = useRouter()
  const [open, setOpen] = useState(false)
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try { return new Set(JSON.parse(localStorage.getItem('admin-notif-read') ?? '[]')) } catch { return new Set() }
  })

  const { data } = useQuery({
    queryKey: ['admin-notif-items'],
    queryFn: async () => { const { data } = await api.get('/admin/notifications'); return data },
    refetchInterval: 30000,
  })

  const items = (data?.items ?? []) as any[]
  const unreadCount = items.filter((n) => !readIds.has(n.id)).length

  const persist = (ids: Set<string>) => {
    setReadIds(ids)
    try { localStorage.setItem('admin-notif-read', JSON.stringify([...ids])) } catch {}
  }

  const handleClickItem = (n: any) => {
    // 1. Mark as read
    const next = new Set(readIds)
    next.add(n.id)
    persist(next)
    // 2. Close dropdown
    setOpen(false)
    // 3. Navigate
    const link = getLink(n)
    navRouter.push(link)
  }

  const handleMarkAllRead = () => {
    const all = new Set(items.map((n: any) => n.id))
    persist(all)
  }

  const getLink = (n: any): string => {
    switch (n.entityType) {
      case 'order': return `/${locale}/admin/orders/${n.entityId}`
      case 'return': return `/${locale}/admin/returns`
      case 'inventory': return `/${locale}/admin/inventory`
      default: return `/${locale}/admin/dashboard`
    }
  }

  const getTitle = (n: any) => {
    const pn = typeof n.productName === 'object' ? (n.productName[locale] ?? n.productName.de ?? '') : (n.productName ?? '')
    switch (n.type) {
      case 'new_order': return t('notif.newOrder', { order: n.orderNumber ?? '', amount: n.amount ?? '' })
      case 'dispute': return t('notif.dispute', { order: n.orderNumber ?? '' })
      case 'low_stock': return t('notif.lowStock', { product: pn })
      case 'return': return t('notif.return', { order: n.orderNumber ?? '' })
      case 'payment_failed': return t('notif.paymentFailed', { order: n.orderNumber ?? '' })
      default: return ''
    }
  }

  const getSub = (n: any) => {
    switch (n.type) {
      case 'new_order': return t('notif.newOrderSub', { customer: n.customer ?? '' })
      case 'dispute': return t('notif.disputeSub', { customer: n.customer ?? '', amount: n.amount ?? '' })
      case 'low_stock': return t('notif.lowStockSub', { count: n.available ?? 0 })
      case 'return': return t('notif.returnSub', { customer: n.customer ?? '' })
      case 'payment_failed': return t('notif.paymentFailedSub', { provider: n.provider ?? '' })
      default: return ''
    }
  }

  const timeAgo = (date: string) => {
    const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
    if (s < 60) return t('notif.ago_just')
    if (s < 3600) return t('notif.ago_min', { n: Math.floor(s / 60) })
    if (s < 86400) return t('notif.ago_hour', { n: Math.floor(s / 3600) })
    return t('notif.ago_day', { n: Math.floor(s / 86400) })
  }

  // Lucide icon per type
  const NotifIcon = ({ type }: { type: string }) => {
    const cfg: Record<string, { Icon: typeof Bell; bg: string; fg: string }> = {
      new_order: { Icon: ShoppingBag, bg: 'bg-blue-100', fg: 'text-blue-600' },
      dispute: { Icon: Bell, bg: 'bg-red-100', fg: 'text-red-600' },
      low_stock: { Icon: Warehouse, bg: 'bg-orange-100', fg: 'text-orange-600' },
      return: { Icon: RotateCcw, bg: 'bg-yellow-100', fg: 'text-yellow-700' },
      payment_failed: { Icon: X, bg: 'bg-red-100', fg: 'text-red-600' },
    }
    const c = cfg[type] ?? { Icon: Bell, bg: 'bg-muted', fg: 'text-muted-foreground' }
    return (
      <div className={`h-10 w-10 rounded-full ${c.bg} flex items-center justify-center flex-shrink-0 transition-transform duration-200 group-hover:scale-105`}>
        <c.Icon className={`h-4.5 w-4.5 ${c.fg}`} />
      </div>
    )
  }

  const dotColor: Record<string, string> = {
    new_order: 'bg-blue-500', dispute: 'bg-red-500', low_stock: 'bg-orange-500',
    return: 'bg-yellow-500', payment_failed: 'bg-red-500',
  }

  return (
    <div className="relative">
      <button
        className={`relative p-2 rounded-lg transition-all duration-200 hover:bg-muted active:scale-95 ${unreadCount > 0 ? 'animate-[bell-shake_4s_ease-in-out_infinite]' : ''}`}
        onClick={() => setOpen(!open)}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-5 min-w-[20px] rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center px-1 animate-[badge-pulse_2s_ease-in-out_infinite]">
            {unreadCount}
          </span>
        )}
      </button>

      <style>{`
        @keyframes bell-shake { 0%,100%{transform:rotate(0)} 2%{transform:rotate(8deg)} 4%{transform:rotate(-8deg)} 6%{transform:rotate(4deg)} 8%{transform:rotate(0)} }
        @keyframes badge-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.15)} }
        @keyframes notif-slide { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes notif-fade { from{opacity:0;transform:translateY(-4px)scale(.98)} to{opacity:1;transform:translateY(0)scale(1)} }
      `}</style>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 rtl:right-auto rtl:left-0 top-full mt-2 w-96 bg-background border rounded-2xl shadow-2xl z-50 overflow-hidden" style={{ animation: 'notif-fade 200ms ease-out' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b bg-muted/20">
              <div>
                <h3 className="text-sm font-bold">{t('notif.title')}</h3>
                {unreadCount > 0 && <p className="text-xs text-muted-foreground">{t('notif.unread', { count: unreadCount })}</p>}
              </div>
              {unreadCount > 0 && (
                <button onClick={handleMarkAllRead} className="text-xs text-primary hover:underline font-medium transition-colors">
                  {t('notif.markAllRead')}
                </button>
              )}
            </div>

            {/* Items */}
            <div className="max-h-[28rem] overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <Bell className="h-10 w-10 mx-auto mb-3 text-muted-foreground/20" />
                  <p className="text-sm text-muted-foreground">{t('notif.empty')}</p>
                </div>
              ) : items.slice(0, 10).map((n: any, i: number) => {
                const isUnread = !readIds.has(n.id)
                const isDanger = n.type === 'dispute' || n.type === 'payment_failed'
                return (
                  <button
                    key={n.id}
                    type="button"
                    style={{ animation: `notif-slide 300ms ease-out ${i * 40}ms both` }}
                    className={`group w-full text-left rtl:text-right flex items-start gap-3.5 px-5 py-3.5 transition-all duration-200 hover:bg-muted/50 ${isUnread ? 'bg-primary/[0.04]' : ''}`}
                    onClick={() => handleClickItem(n)}
                  >
                    <NotifIcon type={n.type} />
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center gap-2">
                        <p className={`text-[13px] leading-snug ${isUnread ? 'font-bold' : 'font-medium'} ${isDanger ? 'text-red-600' : ''}`}>
                          {getTitle(n)}
                        </p>
                        {isUnread && <span className={`h-2 w-2 rounded-full flex-shrink-0 ${dotColor[n.type] ?? 'bg-primary'}`} />}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{getSub(n)}</p>
                      <p className="text-[10px] text-muted-foreground/50 mt-1">{timeAgo(n.createdAt)}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
