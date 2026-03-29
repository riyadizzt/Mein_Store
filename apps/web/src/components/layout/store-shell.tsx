'use client'

import { usePathname } from 'next/navigation'
import { Header } from './header'
import { Footer } from './footer'
import { MobileNav } from './mobile-nav'
import { CartDrawer } from './cart-drawer'
import { CookieBanner } from './cookie-banner'
import { OfflineToast } from './offline-toast'

/**
 * StoreShell — renders store chrome (header, footer, mobile nav, cart, cookies)
 * ONLY on non-admin pages. Admin pages have their own layout.
 */
export function StoreShell({ locale, children }: { locale: string; children: React.ReactNode }) {
  const pathname = usePathname()
  const isAdmin = pathname.includes('/admin')

  if (isAdmin) {
    return <>{children}</>
  }

  return (
    <>
      <Header locale={locale} />
      <main className="min-h-screen pb-16 lg:pb-0">{children}</main>
      <Footer locale={locale} />
      <MobileNav locale={locale} />
      <CartDrawer locale={locale} />
      <CookieBanner />
      <OfflineToast />
    </>
  )
}
