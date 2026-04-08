'use client'

import { useState, useEffect, useRef, forwardRef } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import Link from 'next/link'
import Image from 'next/image'
import { X, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { useCartStore } from '@/store/cart-store'
import { toast } from '@/store/toast-store'
import { Button } from '@/components/ui/button'
import { motion, AnimatePresence } from 'motion/react'

/* ── Swipeable Cart Item ── */
const CartItem = forwardRef<HTMLDivElement, {
  item: any
  locale: string
  maxStock: number
  isRTL: boolean
  onRemove: () => void
  onUpdate: (qty: number) => void
}>(function CartItem({ item, locale, maxStock, isRTL, onRemove, onUpdate }, ref) {
  const t = useTranslations('cart')
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
    // Swipe toward delete: left in LTR, right in RTL
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

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -80, transition: { duration: 0.25 } }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className="relative overflow-hidden rounded-xl"
    >
      {/* Delete background revealed on swipe */}
      <div className={`absolute inset-y-0 w-24 bg-destructive/90 flex items-center justify-center rounded-xl ${isRTL ? 'left-0' : 'right-0'}`}>
        <Trash2 className="h-5 w-5 text-white" />
      </div>

      {/* Item content — swipeable */}
      <div
        ref={dragRef}
        className="relative flex gap-4 bg-background p-1 transition-transform duration-200 ease-out"
        style={{ transform: `translateX(${offsetX}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Image */}
        <div className="w-20 h-20 bg-muted rounded-xl overflow-hidden flex-shrink-0">
          {item.imageUrl ? (
            <Image
              src={item.imageUrl}
              alt={item.name}
              width={80}
              height={80}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
              {item.sku}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {item.names?.[locale] ?? item.name}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {item.color && `${item.color}`}
            {item.color && item.size && ' / '}
            {item.size && `${item.size}`}
          </p>
          <p className="text-sm font-semibold mt-1">
            &euro;{item.unitPrice.toFixed(2)}
          </p>

          {/* Quantity */}
          <div className="flex items-center gap-2 mt-2">
            <motion.button
              whileTap={{ scale: 0.85 }}
              onClick={() => onUpdate(Math.max(1, item.quantity - 1))}
              disabled={item.quantity <= 1}
              className="h-10 w-10 rounded-lg border flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-30"
            >
              <Minus className="h-3 w-3" />
            </motion.button>
            <span className="text-sm font-medium w-6 text-center tabular-nums">
              {item.quantity}
            </span>
            <motion.button
              whileTap={{ scale: 0.85 }}
              onClick={() => {
                const max = Math.min(10, maxStock)
                if (item.quantity < max) onUpdate(item.quantity + 1)
              }}
              disabled={item.quantity >= Math.min(10, maxStock)}
              className="h-10 w-10 rounded-lg border flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-30"
            >
              <Plus className="h-3 w-3" />
            </motion.button>
            <button
              onClick={onRemove}
              className="ml-auto text-xs text-destructive hover:underline"
            >
              {t('remove')}
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

  // Stock check
  const [stockMap, setStockMap] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!isDrawerOpen || items.length === 0) return
    const variantIds = items.map((i) => i.variantId)
    fetch(
      `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/v1/products/stock-check`,
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

          {/* Drawer — spring entrance */}
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
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">{t('title')}</h2>
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
                  <div className="h-24 w-24 rounded-full bg-brand-gold/10 flex items-center justify-center mx-auto">
                    <ShoppingBag className="h-10 w-10 text-brand-gold/40" />
                  </div>
                </motion.div>
                <motion.div
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.15 }}
                >
                  <p className="font-medium text-foreground">{t('empty')}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t('emptyHint')}
                  </p>
                </motion.div>
                <Button variant="outline" onClick={closeDrawer} className="btn-press mt-2">
                  {t('continueShopping')}
                </Button>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                  <AnimatePresence mode="popLayout">
                    {items.map((item) => (
                      <CartItem
                        key={item.variantId}
                        item={item}
                        locale={locale}
                        maxStock={stockMap[item.variantId] ?? 10}
                        isRTL={isRTL}
                        onRemove={() => {
                          const snapshot = { ...item }
                          removeItem(item.variantId)
                          toast.success(
                            t('removedFromCart'),
                            {
                              undo: () => {
                                useCartStore.getState().addItem(snapshot)
                              },
                            },
                          )
                        }}
                        onUpdate={(qty) =>
                          updateQuantity(item.variantId, qty)
                        }
                      />
                    ))}
                  </AnimatePresence>
                </div>

                {/* Footer */}
                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.15 }}
                  className="border-t px-6 py-4 space-y-3 bg-muted/30"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      {t('subtotal')}
                    </span>
                    <span className="text-lg font-bold tabular-nums">
                      &euro;{subtotal.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('shippingCalculatedAtCheckout')}
                  </p>
                  <Link
                    href={`/${locale}/checkout`}
                    onClick={closeDrawer}
                    className="block"
                  >
                    <Button className="w-full h-12 btn-press" size="lg">
                      {t('checkout')}
                    </Button>
                  </Link>
                </motion.div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
