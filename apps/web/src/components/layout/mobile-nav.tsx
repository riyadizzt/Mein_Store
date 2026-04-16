'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { Home, Grid3X3, ShoppingBag, User } from 'lucide-react'
import { useCartStore } from '@/store/cart-store'

export function MobileNav({ locale }: { locale: string }) {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  const itemCount = useCartStore((s) => s.itemCount())
  const openDrawer = useCartStore((s) => s.openDrawer)

  useEffect(() => { setMounted(true) }, [])

  const isActive = (path: string) => pathname === `/${locale}${path}` || pathname.startsWith(`/${locale}${path}/`)

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-t border-border/50 safe-bottom">
      <div className="grid grid-cols-4 h-16">
        <Link
          href={`/${locale}`}
          className={`flex flex-col items-center justify-center gap-0.5 text-xs transition-colors ${
            isActive('') && !isActive('/products') && !isActive('/account')
              ? 'text-accent'
              : 'text-muted-foreground'
          }`}
        >
          <Home className="h-6 w-6" />
          {t('home')}
        </Link>

        <Link
          href={`/${locale}/products`}
          className={`flex flex-col items-center justify-center gap-0.5 text-xs transition-colors ${
            isActive('/products') ? 'text-accent' : 'text-muted-foreground'
          }`}
        >
          <Grid3X3 className="h-6 w-6" />
          {t('products')}
        </Link>

        <button
          onClick={openDrawer}
          className="flex flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground relative"
        >
          <ShoppingBag className="h-6 w-6" />
          {mounted && itemCount > 0 && (
            <span className="absolute top-1.5 right-1/4 h-4 w-4 rounded-full bg-accent text-accent-foreground text-[9px] font-bold flex items-center justify-center">
              {itemCount > 99 ? '99+' : itemCount}
            </span>
          )}
          {t('cart')}
        </button>

        <Link
          href={`/${locale}/account`}
          className={`flex flex-col items-center justify-center gap-0.5 text-xs transition-colors ${
            isActive('/account') ? 'text-accent' : 'text-muted-foreground'
          }`}
        >
          <User className="h-6 w-6" />
          {t('account')}
        </Link>
      </div>
    </nav>
  )
}
