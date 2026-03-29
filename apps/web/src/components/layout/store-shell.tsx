'use client'

import { usePathname } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Header } from './header'

// Lazy load below-fold / non-critical shell components
const Footer = dynamic(() => import('./footer').then((m) => ({ default: m.Footer })))
const MobileNav = dynamic(() => import('./mobile-nav').then((m) => ({ default: m.MobileNav })), { ssr: false })
const CartDrawer = dynamic(() => import('./cart-drawer').then((m) => ({ default: m.CartDrawer })), { ssr: false })
const CookieBanner = dynamic(() => import('./cookie-banner').then((m) => ({ default: m.CookieBanner })), { ssr: false })
const OfflineToast = dynamic(() => import('./offline-toast').then((m) => ({ default: m.OfflineToast })), { ssr: false })

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
