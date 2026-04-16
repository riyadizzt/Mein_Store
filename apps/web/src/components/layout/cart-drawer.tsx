'use client'

import { API_BASE_URL } from '@/lib/env'
import { useState, useEffect, useRef, forwardRef } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import Link from 'next/link'
import Image from 'next/image'
import { X, ShoppingBag, Trash2, Info } from 'lucide-react'
import { useCartStore } from '@/store/cart-store'
import { toast } from '@/store/toast-store'
import { Button } from '@/components/ui/button'
import { motion, AnimatePresence } from 'motion/react'
import { translateColor } from '@/lib/locale-utils'
import { VisaLogo, MastercardLogo, PayPalLogo, KlarnaLogo } from '@/components/ui/payment-logos'

/* ── Zalando-style Cart Item ── */
const CartItem = forwardRef<HTMLDivElement, {
  item: any
  locale: string
  maxStock: number
  isRTL: boolean
  onRemove: () => void
  onUpdate: (qty: number) => void
  onClose: () => void
}>(function CartItem({ item, locale, maxStock, isRTL, onRemove, onUpdate, onClose }, ref) {
  const dragRef = useRef<HTMLDivElement>(null)
  const [offsetX, setOffsetX] = useState(0)
  const startX = useRef(0)
  const startTime = useRef(0)

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX
    startTime.current = Date.now()
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    const diff = e.touches[0].clientX - startX.current
    setOffsetX(isRTL ? Math.max(0, diff) : Math.min(0, diff))
  }

  const handleTouchEnd = () => {
    const velocity = Math.abs(offsetX) / (Date.now() - startTime.current)
    const threshold = isRTL ? (offsetX > 100 || (offsetX > 50 && velocity > 0.3)) : (offsetX < -100 || (offsetX < -50 && velocity > 0.3))
    if (threshold) {
      onRemove()
    } else {
      setOffsetX(0)
    }
  }

  const max = Math.min(10, maxStock)
  const displayName = item.names?.[locale] ?? item.name

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -80, transition: { duration: 0.25 } }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className="relative overflow-hidden"
    >
      {/* Delete background revealed on swipe */}
      <div className={`absolute inset-y-0 w-24 bg-destructive/90 flex items-center justify-center ${isRTL ? 'left-0' : 'right-0'}`}>
        <Trash2 className="h-5 w-5 text-white" />
      </div>

      {/* Item content — swipeable */}
      <div
        ref={dragRef}
        className="relative flex gap-4 bg-background py-4 transition-transform duration-200 ease-out"
        style={{ transform: `translateX(${offsetX}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Image — always clickable */}
        {(() => {
          const imgContent = item.imageUrl ? (
            <Image src={item.imageUrl} alt={displayName} width={100} height={120} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-[#f0ebe3] text-[#a09078] text-lg font-semibold">{(displayName || 'M').charAt(0).toUpperCase()}</div>
          )
          const cls = "w-[100px] h-[120px] bg-muted rounded-lg overflow-hidden flex-shrink-0 block"
          return item.slug ? (
            <Link href={`/${locale}/products/${item.slug}`} onClick={onClose} className={cls}>{imgContent}</Link>
          ) : (
            <div className={cls}>{imgContent}</div>
          )
        })()}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              {item.slug ? (
                <Link href={`/${locale}/products/${item.slug}`} onClick={onClose} className="text-sm font-semibold line-clamp-2 hover:underline block">
                  {displayName}
                </Link>
              ) : (
                <p className="text-sm font-semibold line-clamp-2">{displayName}</p>
              )}
            </div>
            {/* Zalando-style X button */}
            <button onClick={onRemove} className="p-1 -mt-1 -me-1 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
              <X className="h-5 w-5" strokeWidth={1.5} />
            </button>
          </div>

          <p className="text-sm font-bold mt-1 tabular-nums">&euro;{item.unitPrice.toFixed(2)}</p>

          <p className="text-xs text-muted-foreground mt-1.5">
            {item.color && <>{locale === 'ar' ? 'اللون' : locale === 'en' ? 'Color' : 'Farbe'}: {translateColor(item.color, locale)}</>}
            {item.color && item.size && <br />}
            {item.size && <>{locale === 'ar' ? 'المقاس' : locale === 'en' ? 'Size' : 'Größe'}: {item.size}</>}
          </p>

          {/* Quantity +/- inline */}
          <div className="inline-grid grid-cols-3 mt-3 border rounded-lg overflow-hidden" dir="ltr" style={{ width: 108 }}>
            <button
              onClick={() => onUpdate(Math.max(1, item.quantity - 1))}
              disabled={item.quantity <= 1}
              className="h-9 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-25"
            >
              <span className="text-base leading-none">&#8722;</span>
            </button>
            <span className="h-9 text-center text-sm font-semibold tabular-nums border-x leading-9">
              {item.quantity}
            </span>
            <button
              onClick={() => { if (item.quantity < max) onUpdate(item.quantity + 1) }}
              disabled={item.quantity >= max}
              className="h-9 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-25"
            >
              <span className="text-base leading-none">+</span>
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
})

/* ── Cart Drawer ── */
export function CartDrawer({ locale }: { locale: string }) {
  const t = useTranslations('cart')
  const currentLocale = useLocale()
  const isRTL = currentLocale === 'ar'
  const { items, isDrawerOpen, closeDrawer, removeItem, updateQuantity } =
    useCartStore()
  const subtotal = useCartStore((s) => s.subtotal())
  const itemCount = useCartStore((s) => s.itemCount())

  const t3 = (d: string, e: string, a: string) => currentLocale === 'ar' ? a : currentLocale === 'en' ? e : d

  // Stock check
  const [stockMap, setStockMap] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!isDrawerOpen || items.length === 0) return
    const variantIds = items.map((i) => i.variantId)
    fetch(
      `${API_BASE_URL}/api/v1/products/stock-check`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantIds }),
      },
    )
      .then((r) => (r.ok ? r.json() : {}))
      .then(setStockMap)
      .catch(() => {})
  }, [isDrawerOpen, items.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Slug backfill — fetch slugs for old cart items that don't have them
  const [slugMap, setSlugMap] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!isDrawerOpen || items.length === 0) return
    const missing = items.filter((i) => !i.slug)
    if (missing.length === 0) return
    const ids = [...new Set(missing.map((i) => i.productId))]
    Promise.all(
      ids.map((id) =>
        fetch(`${API_BASE_URL}/api/v1/products/${id}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ),
    ).then((results) => {
      const map: Record<string, string> = {}
      for (const p of results) {
        if (p?.slug) map[p.id] = p.slug
      }
      setSlugMap(map)
    })
  }, [isDrawerOpen, items.length]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AnimatePresence>
      {isDrawerOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="cart-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={closeDrawer}
          />

          {/* Drawer */}
          <motion.div
            key="cart-drawer"
            initial={{ x: isRTL ? '-100%' : '100%' }}
            animate={{ x: 0 }}
            exit={{ x: isRTL ? '-100%' : '100%' }}
            transition={{ type: 'spring', stiffness: 350, damping: 35 }}
            className={`fixed top-0 z-50 h-full w-full max-w-md bg-background shadow-2xl flex flex-col ${
              isRTL ? 'left-0' : 'right-0'
            }`}
          >
            {/* Header — Zalando-style with item count */}
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-bold">
                {t('title')}
                {itemCount > 0 && (
                  <span className="text-muted-foreground font-normal ms-1">({itemCount})</span>
                )}
              </h2>
              <motion.button
                whileTap={{ scale: 0.9, rotate: 90 }}
                onClick={closeDrawer}
                className="p-1 hover:bg-muted rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </motion.button>
            </div>

            {/* Items */}
            {items.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
                <motion.div
                  initial={{ scale: 0.6, opacity: 0, rotate: -10 }}
                  animate={{ scale: 1, opacity: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                >
                  <div className="h-24 w-24 rounded-full bg-muted flex items-center justify-center mx-auto">
                    <ShoppingBag className="h-10 w-10 text-muted-foreground/40" />
                  </div>
                </motion.div>
                <motion.div
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.15 }}
                >
                  <p className="font-medium text-foreground">{t('empty')}</p>
                  <p className="text-sm text-muted-foreground mt-1">{t('emptyHint')}</p>
                </motion.div>
                <Button variant="outline" onClick={closeDrawer} className="btn-press mt-2">
                  {t('continueShopping')}
                </Button>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-6 divide-y">
                  <AnimatePresence mode="popLayout">
                    {items.map((item) => (
                      <CartItem
                        key={item.variantId}
                        item={{ ...item, slug: item.slug || slugMap[item.productId] }}
                        locale={locale}
                        maxStock={stockMap[item.variantId] ?? 10}
                        isRTL={isRTL}
                        onClose={closeDrawer}
                        onRemove={() => {
                          const snapshot = { ...item }
                          removeItem(item.variantId)
                          toast.success(t('removedFromCart'), {
                            undo: () => { useCartStore.getState().addItem(snapshot) },
                          })
                        }}
                        onUpdate={(qty) => updateQuantity(item.variantId, qty)}
                      />
                    ))}
                  </AnimatePresence>
                </div>

                {/* Info notice */}
                <div className="px-6 py-2.5 border-t flex items-center gap-2 text-xs text-muted-foreground">
                  <Info className="h-3.5 w-3.5 flex-shrink-0" />
                  {t3(
                    'Artikel im Warenkorb werden nicht reserviert.',
                    'Items in the cart are not reserved.',
                    'المنتجات في السلة غير محجوزة.',
                  )}
                </div>

                {/* Footer — Zalando-style summary */}
                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.15 }}
                  className="border-t px-6 pt-4 pb-5 space-y-3 bg-muted/20"
                >
                  {/* Summary lines */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{t3('Zwischensumme', 'Subtotal', 'المجموع الفرعي')}</span>
                      <span className="tabular-nums">&euro;{subtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{t3('Lieferung', 'Delivery', 'التوصيل')}</span>
                      <span className="text-muted-foreground tabular-nums">{t3('Wird berechnet', 'Calculated at checkout', 'يُحسب لاحقاً')}</span>
                    </div>
                    <div className="flex items-center justify-between font-bold pt-1.5 border-t">
                      <span>{t3('Gesamtsumme', 'Total', 'الإجمالي')} <span className="text-xs font-normal text-muted-foreground">{t3('inkl. MwSt.', 'incl. VAT', 'شامل الضريبة')}</span></span>
                      <span className="text-lg tabular-nums">&euro;{subtotal.toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Checkout CTA — Zalando black */}
                  <Link href={`/${locale}/checkout`} onClick={closeDrawer} className="block">
                    <button className="w-full h-12 bg-[#0f1419] text-white font-semibold rounded-lg hover:bg-[#1a1a2e] transition-colors text-sm tracking-wide">
                      {t('checkout')}
                    </button>
                  </Link>

                  {/* Payment logos */}
                  <div className="flex items-center justify-center gap-2 pt-1">
                    <div className="h-7 px-2 rounded bg-white border flex items-center"><VisaLogo className="h-5" /></div>
                    <div className="h-7 px-2 rounded bg-white border flex items-center"><MastercardLogo className="h-5" /></div>
                    <div className="h-7 px-2 rounded bg-white border flex items-center"><PayPalLogo className="h-4" /></div>
                    <div className="h-7 px-1.5 rounded bg-white border flex items-center"><KlarnaLogo className="h-4" /></div>
                    <div className="h-7 px-1.5 rounded bg-black border border-white/20 flex items-center">
                      <span className="text-white text-[10px] font-semibold flex items-center gap-0.5">
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="white"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>Pay
                      </span>
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
