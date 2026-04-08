'use client'

import { useTranslations, useLocale } from 'next-intl'
import Link from 'next/link'
import { Search, ShoppingBag, User, Menu, X, ChevronDown, HelpCircle } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useCartStore } from '@/store/cart-store'
import { useAuthStore } from '@/store/auth-store'
import { useShopSettings } from '@/hooks/use-shop-settings'
import { useCategories } from '@/hooks/use-categories'
import { LanguageSwitcher } from './language-switcher'
import { SearchOverlay } from './search-overlay'

export function Header({ locale }: { locale: string }) {
  const t = useTranslations('nav')
  const loc = useLocale()
  const { data: shopSettings } = useShopSettings()
  const { data: categories } = useCategories()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [hoveredDept, setHoveredDept] = useState<string | null>(null)
  const [expandedMobile, setExpandedMobile] = useState<string | null>(null)
  const [scrolled, setScrolled] = useState(false)
  const itemCount = useCartStore((s) => s.itemCount())
  const openDrawer = useCartStore((s) => s.openDrawer)
  const { isAuthenticated, user } = useAuthStore()

  useEffect(() => { setMounted(true) }, [])

  /* Scroll-shrink: track scroll position */
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  /* Cmd+K / Ctrl+K keyboard shortcut for search */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [searchOpen])

  const departments = (categories ?? []) as any[]

  const getName = (cat: any) => {
    if (!cat) return ''
    return cat.name
      ?? cat.translations?.find((t: any) => t.language === loc)?.name
      ?? cat.translations?.[0]?.name
      ?? cat.slug
  }

  return (
    <>
      <header
        className={`sticky top-0 z-50 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60 border-b transition-all duration-300 ${
          scrolled
            ? 'bg-background/95 border-border/80 shadow-soft'
            : 'bg-background/80 border-border/50'
        }`}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div
            className={`flex items-center justify-between transition-all duration-300 ${
              scrolled ? 'h-14' : 'h-16'
            }`}
          >
            {/* Mobile menu button */}
            <button
              className="lg:hidden p-2 -ml-2"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={t('menu')}
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>

            {/* Logo — shrinks on scroll + gold shimmer hover */}
            <Link href={`/${locale}`} className="flex-shrink-0">
              <span
                className={`font-bold tracking-[0.2em] uppercase transition-all duration-300 logo-shimmer ${
                  scrolled ? 'text-lg' : 'text-xl'
                }`}
              >
                {shopSettings?.brandName || 'Malak'}
              </span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden lg:flex items-center gap-4 mx-8">
              <Link
                href={`/${locale}`}
                className="px-3 py-2 text-[15px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {t('home')}
              </Link>
              {departments.map((dept) => (
                <div
                  key={dept.id}
                  className="relative"
                  onMouseEnter={() => setHoveredDept(dept.id)}
                  onMouseLeave={() => setHoveredDept(null)}
                  onFocus={() => setHoveredDept(dept.id)}
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node))
                      setHoveredDept(null)
                  }}
                >
                  <Link
                    href={`/${locale}/products?department=${dept.slug}`}
                    className={`flex items-center gap-1.5 px-3 py-2 text-[15px] font-medium transition-colors ${
                      hoveredDept === dept.id
                        ? 'text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {getName(dept)}
                    {(dept.children?.length ?? 0) > 0 && (
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform duration-200 ${
                          hoveredDept === dept.id ? 'rotate-180' : ''
                        }`}
                      />
                    )}
                  </Link>

                  {/* Mega Menu Dropdown */}
                  {hoveredDept === dept.id && dept.children?.length > 0 && (
                    <div className="absolute top-full left-0 rtl:left-auto rtl:right-0 pt-1 z-50">
                      <div className="bg-background border rounded-xl shadow-xl p-5 min-w-[320px] grid grid-cols-2 gap-x-6 gap-y-1 animate-fade-in">
                        {dept.children.map((sub: any) => (
                          <Link
                            key={sub.id ?? sub.slug}
                            href={`/${locale}/products?department=${dept.slug}&category=${sub.slug}`}
                            className="px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                          >
                            {getName(sub)}
                          </Link>
                        ))}
                        <Link
                          href={`/${locale}/products?department=${dept.slug}`}
                          className="col-span-2 mt-2 pt-2 border-t text-sm font-medium text-primary hover:underline"
                        >
                          {getName(dept)} — {t('products')}
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </nav>

            {/* Right Actions */}
            <div className="flex items-center gap-2">
              <button
                className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors group/search relative"
                onClick={() => setSearchOpen(!searchOpen)}
                aria-label={t('search')}
                title="⌘K"
              >
                <Search className="h-5 w-5" />
                <kbd className="hidden lg:flex absolute -bottom-0.5 -right-0.5 h-4 items-center px-1 rounded bg-muted text-[9px] font-mono text-muted-foreground opacity-0 group-hover/search:opacity-100 transition-opacity">
                  ⌘K
                </kbd>
              </button>
              <LanguageSwitcher locale={locale} />
              {mounted && isAuthenticated ? (
                <div className="relative group">
                  <button
                    className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center text-foreground"
                    aria-label={t('account')}
                  >
                    <User className="h-5 w-5" />
                  </button>
                  <div className="absolute right-0 rtl:right-auto rtl:left-0 mt-1 w-44 rounded-xl border bg-background shadow-lg py-1 z-50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
                    <p className="px-4 py-2 text-xs text-muted-foreground border-b">
                      {user?.firstName} {user?.lastName}
                    </p>
                    <Link
                      href={`/${locale}/account`}
                      className="block px-4 py-2 text-sm hover:bg-muted"
                    >
                      {t('account')}
                    </Link>
                    <button
                      onClick={() => {
                        useAuthStore.getState().logout()
                        window.location.href = `/${locale}`
                      }}
                      className="w-full text-start px-4 py-2 text-sm text-destructive hover:bg-destructive/10"
                    >
                      {t('logout')}
                    </button>
                  </div>
                </div>
              ) : (
                <Link
                  href={`/${locale}/auth/login`}
                  className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={t('login')}
                >
                  <User className="h-5 w-5" />
                </Link>
              )}
              <Link
                href={`/${locale}/contact`}
                className="hidden sm:flex p-2.5 min-h-[44px] min-w-[44px] items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                aria-label={loc === 'ar' ? 'مساعدة' : loc === 'en' ? 'Help' : 'Hilfe'}
                title={loc === 'ar' ? 'مساعدة' : loc === 'en' ? 'Help' : 'Hilfe'}
              >
                <HelpCircle className="h-5 w-5" />
              </Link>
              <button
                className="relative p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                onClick={openDrawer}
                aria-label={t('cart')}
              >
                <ShoppingBag className="h-5 w-5" />
                {mounted && itemCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-5 w-5 rounded-full bg-accent text-accent-foreground text-[11px] font-medium flex items-center justify-center animate-bounce-in">
                    {itemCount > 99 ? '99+' : itemCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Search Overlay (replaces inline search bar) */}
          {false && searchOpen && (
            <div className="pb-4 animate-fade-in">
              <form action={`/${locale}/products`} className="relative">
                <Search className="absolute left-3 rtl:left-auto rtl:right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="search"
                  name="q"
                  placeholder={t('searchPlaceholder')}
                  aria-label={t('search')}
                  autoFocus
                  className="w-full h-10 pl-10 rtl:pl-4 rtl:pr-10 pr-4 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 transition-shadow"
                />
              </form>
            </div>
          )}
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t bg-background max-h-[70vh] overflow-y-auto animate-fade-in">
            <nav className="flex flex-col px-4 py-4 gap-0.5">
              <Link
                href={`/${locale}`}
                className="px-3 py-2.5 rounded-lg text-sm font-medium hover:bg-muted transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                {t('home')}
              </Link>

              {departments.map((dept) => (
                <div key={dept.id}>
                  <div className="flex items-center">
                    <Link
                      href={`/${locale}/products?department=${dept.slug}`}
                      className="flex-1 px-3 py-2.5 rounded-lg text-sm font-medium hover:bg-muted transition-colors"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      {getName(dept)}
                    </Link>
                    {dept.children?.length > 0 && (
                      <button
                        onClick={() =>
                          setExpandedMobile(
                            expandedMobile === dept.id ? null : dept.id,
                          )
                        }
                        className="p-2.5 hover:bg-muted rounded-lg"
                      >
                        <ChevronDown
                          className={`h-4 w-4 transition-transform duration-200 ${
                            expandedMobile === dept.id ? 'rotate-180' : ''
                          }`}
                        />
                      </button>
                    )}
                  </div>

                  {expandedMobile === dept.id && dept.children?.length > 0 && (
                    <div className="ml-4 rtl:ml-0 rtl:mr-4 border-l rtl:border-l-0 rtl:border-r pl-2 rtl:pl-0 rtl:pr-2 mb-1">
                      {dept.children.map((sub: any) => (
                        <Link
                          key={sub.id ?? sub.slug}
                          href={`/${locale}/products?department=${dept.slug}&category=${sub.slug}`}
                          className="block px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
                          onClick={() => setMobileMenuOpen(false)}
                        >
                          {getName(sub)}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {!isAuthenticated && (
                <div className="border-t mt-2 pt-2">
                  <Link
                    href={`/${locale}/auth/login`}
                    className="px-3 py-2.5 rounded-lg text-sm font-medium hover:bg-muted transition-colors block"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {t('login')}
                  </Link>
                  <Link
                    href={`/${locale}/auth/register`}
                    className="px-3 py-2.5 rounded-lg text-sm font-medium hover:bg-muted transition-colors block"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {t('register')}
                  </Link>
                </div>
              )}
            </nav>
          </div>
        )}
      </header>
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  )
}
