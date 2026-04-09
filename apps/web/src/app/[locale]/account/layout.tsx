'use client'

import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Package, MapPin, User, Heart, Monitor, Trash2, LogOut, Ruler } from 'lucide-react'
import { useAuthStore } from '@/store/auth-store'
import { motion } from 'motion/react'

const NAV_ITEMS = [
  { key: 'orders', icon: Package, href: '/account/orders' },
  { key: 'addresses', icon: MapPin, href: '/account/addresses' },
  { key: 'measurements', icon: Ruler, href: '/account/measurements' },
  { key: 'profile', icon: User, href: '/account/profile' },
  { key: 'wishlist', icon: Heart, href: '/account/wishlist' },
  { key: 'sessions', icon: Monitor, href: '/account/sessions' },
  { key: 'delete', icon: Trash2, href: '/account/delete' },
]

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const { isAuthenticated, user, logout } = useAuthStore()
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setAuthChecked(true)
      if (!useAuthStore.getState().isAuthenticated) {
        router.push(`/${locale}/auth/login?redirect=account`)
      }
    }, 100)
    return () => clearTimeout(timer)
  }, [router, locale])

  const t = useTranslations('account')

  if (!authChecked || !isAuthenticated) return null

  // Time-of-day greeting from i18n
  const hour = new Date().getHours()
  const greeting = hour < 12 ? t('greetingMorning') : hour < 18 ? t('greetingAfternoon') : t('greetingEvening')

  const labels: Record<string, string> = {
    orders: t('orders.title'),
    addresses: t('addresses.title'),
    measurements: locale === 'ar' ? 'مقاساتي' : locale === 'en' ? 'My Measurements' : 'Meine Maße',
    profile: t('profile.title'),
    wishlist: t('wishlist.title'),
    sessions: t('sessions.title'),
    delete: t('delete.title'),
  }

  return (
    <div className="mx-auto max-w-[1440px] px-4 sm:px-8 lg:px-12 py-4 lg:py-6">
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-10">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:block w-64 flex-shrink-0">
          <div className="sticky top-20 border rounded-2xl p-4 shadow-card">
            {/* User Info + Time Greeting */}
            <div className="flex items-center gap-3 pb-4 mb-3 border-b">
              <div className="h-10 w-10 rounded-full bg-accent/10 flex items-center justify-center text-accent font-bold text-sm">
                {user?.firstName?.charAt(0)}{user?.lastName?.charAt(0)}
              </div>
              <div className="min-w-0">
                <p className="text-xs text-brand-gold font-medium">{greeting}</p>
                <p className="font-semibold text-sm truncate">{user?.firstName} {user?.lastName}</p>
              </div>
            </div>

            <nav className="space-y-0.5 relative">
              {NAV_ITEMS.map((item) => {
                const isActive = pathname.includes(item.href)
                return (
                  <Link
                    key={item.key}
                    href={`/${locale}${item.href}`}
                    className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors duration-200 ${
                      isActive
                        ? 'text-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    } ${item.key === 'delete' ? 'text-destructive hover:text-destructive' : ''}`}
                  >
                    {/* Animated active indicator — subtle gold */}
                    {isActive && (
                      <motion.div
                        layoutId="account-nav-active"
                        className="absolute inset-0 bg-brand-gold/10 border border-brand-gold/20 rounded-xl"
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-3">
                      <item.icon className="h-4.5 w-4.5" />
                      {labels[item.key]}
                    </span>
                  </Link>
                )
              })}
            </nav>

            {/* Logout */}
            <button
              onClick={() => { logout(); router.push(`/${locale}`) }}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-destructive hover:bg-destructive/10 transition-all duration-200 w-full mt-3 border-t pt-3"
            >
              <LogOut className="h-4 w-4" />
              {t('sessions.revokeAll', { defaultValue: 'Abmelden' })}
            </button>
          </div>
        </aside>

        {/* Mobile: Horizontal scroll tabs */}
        <div className="lg:hidden w-full mb-4">
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-4 px-4">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname.includes(item.href)
              return (
                <Link
                  key={item.key}
                  href={`/${locale}${item.href}`}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium whitespace-nowrap flex-shrink-0 transition-all duration-200 ${
                    isActive
                      ? 'bg-brand-gold/15 text-foreground border border-brand-gold/25'
                      : 'bg-muted text-muted-foreground'
                  } ${item.key === 'delete' ? 'text-destructive bg-destructive/10' : ''}`}
                >
                  <item.icon className="h-4 w-4" />
                  {labels[item.key]}
                </Link>
              )
            })}
            <button
              onClick={() => { logout(); router.push(`/${locale}`) }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium whitespace-nowrap flex-shrink-0 bg-destructive/10 text-destructive"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  )
}
