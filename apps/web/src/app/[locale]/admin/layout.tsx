'use client'

import { useEffect, useState, useRef, lazy, Suspense } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNotificationStream } from '@/hooks/use-notification-stream'
import { useNotificationSound } from '@/hooks/use-notification-sound'
import {
  LayoutDashboard, Package, ShoppingBag, Users, Warehouse, Tag,
  MapPin, ScrollText, Menu, X, Bell, LogOut, Globe,
  RotateCcw, Truck, Settings, Users2, Mail, Palette, FileText,
  ScanBarcode, TrendingUp, Receipt, Ticket, Megaphone, Layers,
  HandCoins, PackageOpen, Bot, Camera, Construction, BarChart3, Flame, Ruler, ChevronDown, MessageSquare, ShieldAlert,
} from 'lucide-react'
import { useAuthStore } from '@/store/auth-store'
import { api } from '@/lib/api'
import { translateNotification } from '@/lib/notif-i18n'
import { MaintenanceBanner } from '@/components/admin/maintenance-banner'
import { AdminSessionGuard } from '@/components/admin/admin-session-guard'

const CameraBarcodeScannerOverlay = lazy(() => import('@/components/admin/camera-barcode-scanner').then((m) => ({ default: m.CameraBarcodeScannerOverlay })))

const NAV_GROUPS = [
  {
    label: { de: 'Hauptmenü', en: 'Main', ar: 'الرئيسية' },
    items: [
      { key: 'dashboard', labelKey: 'dashboard', href: '/admin/dashboard', icon: LayoutDashboard, permission: 'dashboard.view' },
      { key: 'orders', labelKey: 'orders', href: '/admin/orders', icon: ShoppingBag, badgeKey: 'openOrders', permission: 'orders.view' },
      { key: 'customers', labelKey: 'users', href: '/admin/customers', icon: Users, permission: 'customers.view' },
      { key: 'contact', labelKey: 'contactMessages', href: '/admin/contact-messages', icon: MessageSquare, badgeKey: 'unreadContactMessages', permission: 'dashboard.view' },
      { key: 'notifications', labelKey: 'notifications', href: '/admin/notifications', icon: Bell, badgeKey: 'unreadNotifications', permission: 'dashboard.view' },
    ],
  },
  {
    label: { de: 'Katalog', en: 'Catalog', ar: 'الكتالوج' },
    items: [
      { key: 'products', labelKey: 'products', href: '/admin/products', icon: Package, permission: 'products.view' },
      { key: 'categories', labelKey: 'categories', href: '/admin/categories', icon: Tag, permission: 'categories.view' },
      { key: 'inventory', labelKey: 'inventory', href: '/admin/inventory', icon: Warehouse, badgeKey: 'lowStock', permission: 'inventory.view' },
      { key: 'etiketten', labelKey: 'etiketten', href: '/admin/etiketten', icon: Layers, permission: 'inventory.view' },
      { key: 'masterBoxes', labelKey: 'masterBoxes', href: '/admin/master-boxes', icon: PackageOpen, permission: 'inventory.view' },
      { key: 'sizing', labelKey: 'sizing', href: '/admin/sizing', icon: Ruler, permission: 'products.view' },
    ],
  },
  {
    label: { de: 'Fulfillment', en: 'Fulfillment', ar: 'التنفيذ' },
    items: [
      { key: 'shipping-zones', labelKey: 'shippingZones', href: '/admin/shipping-zones', icon: MapPin, permission: 'settings.view' },
      { key: 'returns', labelKey: 'returns', href: '/admin/returns', icon: RotateCcw, badgeKey: 'pendingReturns', permission: 'returns.view' },
      { key: 'shipments', labelKey: 'shipments', href: '/admin/shipments', icon: Truck, permission: 'shipping.view' },
    ],
  },
  {
    label: { de: 'Finanzen', en: 'Finance', ar: 'المالية' },
    items: [
      { key: 'finance', labelKey: 'finance', href: '/admin/finance', icon: TrendingUp, permission: 'finance.revenue' },
      { key: 'invoices', labelKey: 'invoices', href: '/admin/invoices', icon: Receipt, permission: 'finance.invoices' },
    ],
  },
  {
    label: { de: 'Marketing', en: 'Marketing', ar: 'التسويق' },
    items: [
      { key: 'campaigns', labelKey: 'campaigns', href: '/admin/campaigns', icon: Flame, permission: 'settings.view' },
      { key: 'coupons', labelKey: 'coupons', href: '/admin/marketing/coupons', icon: Ticket, permission: 'settings.view' },
      { key: 'promotions', labelKey: 'promotions', href: '/admin/marketing/promotions', icon: Megaphone, permission: 'settings.view' },
    ],
  },
  {
    label: { de: 'Verkaufskanäle', en: 'Channels', ar: 'قنوات البيع' },
    items: [
      { key: 'channels', labelKey: 'channels', href: '/admin/channels', icon: Globe, permission: 'settings.view' },
    ],
  },
  {
    label: { de: 'Einkauf', en: 'Purchasing', ar: 'المشتريات' },
    ownerOnly: true,
    items: [
      { key: 'suppliers', labelKey: 'suppliers', href: '/admin/suppliers', icon: HandCoins, permission: 'suppliers.view' },
      { key: 'receiving', labelKey: 'receiving', href: '/admin/suppliers/receiving', icon: PackageOpen, permission: 'suppliers.receiving' },
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
      { key: 'ai', labelKey: 'ai', href: '/admin/ai', icon: Bot, permission: 'settings.view' },
      { key: 'analytics', labelKey: 'analytics', href: '/admin/analytics', icon: BarChart3, permission: 'settings.view' },
      { key: 'maintenance', labelKey: 'maintenance', href: '/admin/maintenance', icon: Construction, permission: 'settings.edit' },
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

// Native-tooltip text for sidebar badges. Explains *what* the count means so
// the admin never confuses "open orders" with "unread notifications" — a
// confusion the old UI quietly invited. Keep short: shown as browser tooltip.
function badgeExplainer(badgeKey: string | undefined, count: number, locale: string): string {
  if (!badgeKey) return ''
  const dict: Record<string, { de: string; en: string; ar: string }> = {
    openOrders: {
      de: `${count} offene Bestellung${count === 1 ? '' : 'en'} (pending, pending_payment, confirmed, processing)`,
      en: `${count} open order${count === 1 ? '' : 's'} (pending, pending_payment, confirmed, processing)`,
      ar: `${count} طلب${count === 1 ? '' : 'ات'} مفتوح (قيد الانتظار، بانتظار الدفع، مؤكد، قيد المعالجة)`,
    },
    unreadNotifications: {
      de: `${count} ungelesene Benachrichtigung${count === 1 ? '' : 'en'}`,
      en: `${count} unread notification${count === 1 ? '' : 's'}`,
      ar: `${count} إشعار${count === 1 ? '' : 'ات'} غير مقروء`,
    },
    lowStock: {
      de: `${count} Artikel mit niedrigem Bestand`,
      en: `${count} item${count === 1 ? '' : 's'} low on stock`,
      ar: `${count} منتج${count === 1 ? '' : 'ات'} بمخزون منخفض`,
    },
    pendingReturns: {
      de: `${count} offene Retoure${count === 1 ? '' : 'n'} zur Prüfung`,
      en: `${count} return${count === 1 ? '' : 's'} waiting for review`,
      ar: `${count} طلب${count === 1 ? '' : 'ات'} إرجاع بانتظار المراجعة`,
    },
    unreadContactMessages: {
      de: `${count} neue Kontakt-Nachricht${count === 1 ? '' : 'en'}`,
      en: `${count} new contact message${count === 1 ? '' : 's'}`,
      ar: `${count} رسالة تواصل جديدة`,
    },
  }
  const entry = dict[badgeKey]
  if (!entry) return ''
  return entry[locale as 'de' | 'en' | 'ar'] ?? entry.de
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const locale = useLocale()
  const t = useTranslations('admin')
  const router = useRouter()
  const pathname = usePathname()
  const { adminUser: user, isAdminAuthenticated: isAuthenticated, adminLogout: logout } = useAuthStore()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
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
      const [{ data: dash }, { data: unread }, contact] = await Promise.all([
        api.get('/admin/dashboard'),
        api.get('/admin/notifications/unread'),
        api.get('/contact/admin/unread').catch(() => ({ data: { count: 0 } })),
      ])
      return {
        // Orders that need admin attention: unpaid-in-flight + paid-waiting-to-ship.
        // pending_payment is included so the admin sees incoming checkouts even
        // before the customer completes the payment (cleaned up after 10min by
        // the payment-timeout cron, so this count stays small and meaningful).
        openOrders: dash?.ordersByStatus
          ?.filter((s: any) => ['pending', 'pending_payment', 'confirmed', 'processing'].includes(s.status))
          .reduce((sum: number, s: any) => sum + s.count, 0) ?? 0,
        lowStock: dash?.lowStock?.length ?? 0,
        disputes: dash?.disputes?.count ?? 0,
        pendingReturns: dash?.pendingReturns?.count ?? 0,
        unreadNotifications: unread?.count ?? 0,
        unreadContactMessages: (contact as any)?.data?.count ?? 0,
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

  const isActive = (href: string) => {
    const fullPath = `/${locale}${href}`
    return pathname === fullPath || (pathname.startsWith(fullPath + '/') && !href.endsWith('/'))
  }

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
              // ownerOnly groups: nur super_admin sieht sie
              if ((group as any).ownerOnly && user?.role !== 'super_admin') return null
              const visibleItems = group.items.filter((item) => hasPermission(user, item.permission))
              if (visibleItems.length === 0) return null
              const groupKey = group.label.en
              const hasActiveItem = visibleItems.some((item) => isActive(item.href))
              const isCollapsed = collapsedGroups.has(groupKey) && !hasActiveItem
              const toggleGroup = () => setCollapsedGroups((prev) => {
                const next = new Set(prev)
                next.has(groupKey) ? next.delete(groupKey) : next.add(groupKey)
                return next
              })
              return (
                <div key={groupKey}>
                  <button onClick={toggleGroup} className="w-full flex items-center justify-between px-3 pt-4 pb-2 group/hdr">
                    <span className="text-xs font-bold uppercase tracking-[0.12em] text-[#d4a853]/60 group-hover/hdr:text-[#d4a853]/90 transition-colors">
                      {(group.label as any)[locale] || group.label.de}
                    </span>
                    <ChevronDown className={`h-3 w-3 text-white/20 transition-transform ${isCollapsed ? 'ltr:-rotate-90 rtl:rotate-90' : ''}`} />
                  </button>
                  {!isCollapsed && (
                  <div className="space-y-0.5">
                    {visibleItems.map((item) => {
                      const active = isActive(item.href)
                      const badge = (item as any).badgeKey ? (notifications as any)?.[(item as any).badgeKey] : 0
                      // Native browser tooltip — explains exactly what the
                      // badge counts so the admin never wonders "why does
                      // this say 40?". Only shown when there IS a badge.
                      const badgeTooltip = badge > 0 ? badgeExplainer((item as any).badgeKey, badge, locale) : undefined
                      return (
                        <Link
                          key={item.key}
                          href={`/${locale}${item.href}`}
                          onClick={() => setSidebarOpen(false)}
                          title={badgeTooltip}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[15px] transition-all group relative ${
                            active
                              ? 'bg-[#d4a853]/15 text-[#d4a853] font-semibold'
                              : 'text-white/70 hover:text-white hover:bg-white/5'
                          }`}
                        >
                          {active && <div className="absolute ltr:left-0 rtl:right-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full bg-[#d4a853]" />}
                          <item.icon className={`h-[18px] w-[18px] transition-colors ${active ? 'text-[#d4a853]' : 'text-white/30 group-hover:text-white/60'}`} />
                          <span className="flex-1">{t(`nav.${item.labelKey}`)}</span>
                          {badge > 0 && (
                            <span
                              title={badgeTooltip}
                              className={`h-5 min-w-[20px] rounded-full text-[10px] font-bold flex items-center justify-center px-1.5 ${
                                active ? 'bg-[#d4a853] text-white' : 'bg-red-500 text-white'
                              }`}
                            >
                              {badge}
                            </span>
                          )}
                        </Link>
                      )
                    })}
                  </div>
                  )}
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
          <AdminSessionGuard />
          <MaintenanceBanner />
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
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)

  // SSE real-time stream
  const { lastNotification } = useNotificationStream()

  // Sound on new order
  const { playDing, enableSound } = useNotificationSound()

  // Request browser push permission on first click
  const pushAsked = useRef(false)

  // Fetch notifications from DB
  const { data } = useQuery({
    queryKey: ['admin-notifications'],
    queryFn: async () => { const { data } = await api.get('/admin/notifications', { params: { limit: 15 } }); return data },
    refetchInterval: 30000,
  })

  // Unread count
  const { data: unreadData } = useQuery({
    queryKey: ['admin-notifications-unread'],
    queryFn: async () => { const { data } = await api.get('/admin/notifications/unread'); return data },
    refetchInterval: 30000,
  })

  const items = (data?.data ?? data?.items ?? []) as any[]
  const unreadCount = unreadData?.count ?? items.filter((n: any) => !n.isRead).length

  // Enable sound on first user interaction anywhere on the page
  useEffect(() => {
    const handler = () => { enableSound(); document.removeEventListener('click', handler) }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [enableSound])

  // React to SSE notification — play sound + push for important types
  const SOUND_TYPES = ['new_order', 'order_cancelled', 'return_submitted', 'payment_failed']
  useEffect(() => {
    if (!lastNotification) return
    if (SOUND_TYPES.includes(lastNotification.type)) {
      playDing()
    }
    // Browser push if tab is hidden
    if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const translated = translateNotif(lastNotification)
      const n = new Notification(translated.title, {
        body: translated.body,
        icon: '/favicon.ico',
        tag: lastNotification.id,
      })
      n.onclick = () => { window.focus(); navRouter.push(`/${locale}/admin/orders/${lastNotification.entityId}`) }
    }
  }, [lastNotification]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClickItem = async (n: any) => {
    if (!n.isRead) await api.post(`/admin/notifications/read/${n.id}`)
    qc.invalidateQueries({ queryKey: ['admin-notifications'] })
    qc.invalidateQueries({ queryKey: ['admin-notifications-unread'] })
    setOpen(false)
    const link = n.entityType === 'order' ? `/${locale}/admin/orders/${n.entityId}` :
                 n.entityType === 'return' ? `/${locale}/admin/returns` :
                 n.entityType === 'inventory' ? `/${locale}/admin/inventory` :
                 n.entityType === 'contact_message' ? `/${locale}/admin/contact-messages` :
                 n.entityType === 'user' ? `/${locale}/admin/customers/${n.entityId}` :
                 `/${locale}/admin/dashboard`
    navRouter.push(link)
  }

  const handleMarkAllRead = async () => {
    await api.post('/admin/notifications/read-all')
    qc.invalidateQueries({ queryKey: ['admin-notifications'] })
    qc.invalidateQueries({ queryKey: ['admin-notifications-unread'] })
  }

  const handleBellClick = () => {
    enableSound()
    setOpen(!open)
    // Ask for push permission once
    if (!pushAsked.current && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      pushAsked.current = true
      Notification.requestPermission()
    }
  }

  const timeAgo = (date: string) => {
    const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
    if (s < 60) return locale === 'ar' ? 'الآن' : locale === 'en' ? 'just now' : 'gerade'
    if (s < 3600) return `${Math.floor(s / 60)} ${locale === 'ar' ? 'د' : 'min'}`
    if (s < 86400) return `${Math.floor(s / 3600)} ${locale === 'ar' ? 'س' : 'h'}`
    return `${Math.floor(s / 86400)} ${locale === 'ar' ? 'ي' : 'd'}`
  }

  // Translate notification title/body — shared helper so the bell and
  // the full notifications page (/admin/notifications) never drift apart.
  const translateNotif = (n: any) => translateNotification(n, locale)

  const typeConfig: Record<string, { Icon: any; bg: string; fg: string; dot: string }> = {
    new_order: { Icon: ShoppingBag, bg: 'bg-blue-100', fg: 'text-blue-600', dot: 'bg-blue-500' },
    order_cancelled: { Icon: X, bg: 'bg-red-100', fg: 'text-red-600', dot: 'bg-red-500' },
    order_partial_cancelled: { Icon: X, bg: 'bg-orange-100', fg: 'text-orange-600', dot: 'bg-orange-500' },
    orders_auto_cancelled: { Icon: X, bg: 'bg-rose-100', fg: 'text-rose-600', dot: 'bg-rose-500' },
    return_submitted: { Icon: RotateCcw, bg: 'bg-yellow-100', fg: 'text-yellow-700', dot: 'bg-yellow-500' },
    return_approved: { Icon: RotateCcw, bg: 'bg-green-100', fg: 'text-green-600', dot: 'bg-green-500' },
    return_received: { Icon: RotateCcw, bg: 'bg-sky-100', fg: 'text-sky-600', dot: 'bg-sky-500' },
    return_refunded: { Icon: RotateCcw, bg: 'bg-emerald-100', fg: 'text-emerald-600', dot: 'bg-emerald-500' },
    admin_password_reset: { Icon: ShieldAlert, bg: 'bg-purple-100', fg: 'text-purple-600', dot: 'bg-purple-500' },
    maintenance_auto_ended: { Icon: Bell, bg: 'bg-teal-100', fg: 'text-teal-600', dot: 'bg-teal-500' },
    payment_failed: { Icon: X, bg: 'bg-red-100', fg: 'text-red-600', dot: 'bg-red-500' },
    payment_disputed: { Icon: ShieldAlert, bg: 'bg-red-100', fg: 'text-red-700', dot: 'bg-red-600' },
    refund_failed: { Icon: X, bg: 'bg-red-100', fg: 'text-red-600', dot: 'bg-red-500' },
    customer_registered: { Icon: Users, bg: 'bg-green-100', fg: 'text-green-600', dot: 'bg-green-500' },
    coupon_expiring: { Icon: Bell, bg: 'bg-amber-100', fg: 'text-amber-600', dot: 'bg-amber-500' },
    promotion_expiring: { Icon: Bell, bg: 'bg-amber-100', fg: 'text-amber-600', dot: 'bg-amber-500' },
    contact_message: { Icon: MessageSquare, bg: 'bg-indigo-100', fg: 'text-indigo-600', dot: 'bg-indigo-500' },
    account_deletion_requested: { Icon: ShieldAlert, bg: 'bg-red-100', fg: 'text-red-600', dot: 'bg-red-500' },
    // NOTE: 'low_stock' removed — backend never emits this type.
  }

  return (
    <div className="relative">
      <button className={`relative p-2 rounded-lg transition-all hover:bg-muted active:scale-95 ${unreadCount > 0 ? 'animate-[bell-shake_4s_ease-in-out_infinite]' : ''}`}
        onClick={handleBellClick}>
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 ltr:-right-0.5 rtl:-left-0.5 h-5 min-w-[20px] rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center px-1 animate-[badge-pulse_2s_ease-in-out_infinite]">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      <style>{`
        @keyframes bell-shake{0%,100%{transform:rotate(0)}2%{transform:rotate(8deg)}4%{transform:rotate(-8deg)}6%{transform:rotate(4deg)}8%{transform:rotate(0)}}
        @keyframes badge-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}
        @keyframes nf-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
      `}</style>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute ltr:right-0 rtl:left-0 top-full mt-2 w-[380px] max-w-[calc(100vw-2rem)] bg-background border rounded-2xl shadow-2xl z-50 overflow-hidden"
            style={{ animation: 'nf-in 200ms ease-out' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="text-sm font-bold">{t('notif.title')}</h3>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button onClick={handleMarkAllRead} className="text-[11px] text-[#d4a853] hover:underline font-medium">
                    {t('notif.markAllRead')}
                  </button>
                )}
              </div>
            </div>

            {/* Items */}
            <div className="max-h-[400px] overflow-y-auto">
              {items.length === 0 ? (
                <div className="py-12 text-center">
                  <Bell className="h-10 w-10 mx-auto mb-3 text-muted-foreground/15" />
                  <p className="text-sm text-muted-foreground">{t('notif.empty')}</p>
                </div>
              ) : items.map((n: any, i: number) => {
                const cfg = typeConfig[n.type] ?? { Icon: Bell, bg: 'bg-muted', fg: 'text-muted-foreground', dot: 'bg-muted-foreground' }
                const Icon = cfg.Icon
                return (
                  <button key={n.id} type="button" onClick={() => handleClickItem(n)}
                    style={{ animationDelay: `${i * 30}ms`, animation: 'nf-in 200ms ease-out both' }}
                    className={`w-full flex items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-muted/40 border-b border-border/30 last:border-0 ${!n.isRead ? 'bg-[#d4a853]/[0.04]' : ''}`}>
                    <div className={`h-9 w-9 rounded-xl ${cfg.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                      <Icon className={`h-4 w-4 ${cfg.fg}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className={`text-[13px] leading-tight truncate ${!n.isRead ? 'font-bold' : 'font-medium'}`}>{translateNotif(n).title}</p>
                        {!n.isRead && <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />}
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">{translateNotif(n).body}</p>
                      <p className="text-[10px] text-muted-foreground/40 mt-1">{timeAgo(n.createdAt)}</p>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Footer */}
            <div className="border-t px-4 py-2">
              <button onClick={() => { setOpen(false); navRouter.push(`/${locale}/admin/notifications`) }}
                className="w-full text-center text-xs text-[#d4a853] font-medium hover:underline py-1">
                {locale === 'ar' ? 'عرض جميع الإشعارات' : locale === 'en' ? 'View all notifications' : 'Alle Benachrichtigungen'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
