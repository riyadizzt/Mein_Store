'use client'

import { useTranslations } from 'next-intl'
import { useState, useCallback, useEffect } from 'react'
import { Minus, Plus, Heart, Check, ShoppingBag } from 'lucide-react'
import { useCartStore } from '@/store/cart-store'
import { useWishlist } from '@/hooks/use-wishlist'
import { toast } from '@/store/toast-store'
import { Button } from '@/components/ui/button'
import { trackMetaEvent, trackTikTokEvent } from '@/components/tracking-pixels'
import { motion, AnimatePresence } from 'motion/react'

interface AddToCartProps {
  variantId: string
  productId: string
  name: string
  sku: string
  color?: string
  size?: string
  imageUrl?: string
  price: number
  available: number
}

export function AddToCart({
  variantId, productId, name, sku, color, size, imageUrl, price, available,
}: AddToCartProps) {
  const t = useTranslations('product')
  const addItem = useCartStore((s) => s.addItem)
  const [quantity, setQuantity] = useState(1)
  const [added, setAdded] = useState(false)
  const [disabled, setDisabled] = useState(false)

  useEffect(() => {
    setQuantity(1)
    setAdded(false)
  }, [variantId])

  const isOutOfStock = available <= 0
  const maxQty = Math.max(1, Math.min(available, 10))

  useEffect(() => {
    if (quantity > maxQty) setQuantity(maxQty)
  }, [maxQty, quantity])

  const handleAdd = useCallback(() => {
    if (disabled || available <= 0 || quantity > available) return
    setDisabled(true)

    addItem({
      variantId, productId, name, sku, color, size, imageUrl,
      unitPrice: price,
      quantity: Math.min(quantity, available),
    })

    const eventData = {
      content_name: name,
      content_ids: [productId],
      content_type: 'product',
      value: price * Math.min(quantity, available),
      currency: 'EUR',
    }
    trackMetaEvent('AddToCart', eventData)
    trackTikTokEvent('AddToCart', eventData)
    toast.success(t('added'))

    setAdded(true)
    setTimeout(() => {
      setAdded(false)
      setDisabled(false)
    }, 2000)
  }, [disabled, available, addItem, variantId, productId, name, sku, color, size, imageUrl, price, quantity])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {/* Quantity Selector — spring buttons */}
        <div className="flex items-center border rounded-xl">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setQuantity(Math.max(1, quantity - 1))}
            disabled={quantity <= 1}
            className="h-11 w-11 flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-40"
            aria-label="Decrease quantity"
          >
            <Minus className="h-4 w-4" />
          </motion.button>
          <AnimatePresence mode="popLayout">
            <motion.span
              key={quantity}
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 10, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="w-12 h-11 flex items-center justify-center text-sm font-medium"
            >
              {quantity}
            </motion.span>
          </AnimatePresence>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setQuantity(Math.min(maxQty, quantity + 1))}
            disabled={quantity >= maxQty}
            className="h-11 w-11 flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-40"
            aria-label="Increase quantity"
          >
            <Plus className="h-4 w-4" />
          </motion.button>
        </div>

        {/* Add to Cart Button — animated state change */}
        <motion.div className="flex-1" whileTap={!isOutOfStock && !disabled ? { scale: 0.97 } : undefined}>
          <Button
            size="lg"
            className={`w-full h-13 text-base rounded-xl gap-2 transition-all duration-300 ${
              added
                ? 'bg-green-600 hover:bg-green-600 text-white'
                : 'bg-accent text-accent-foreground hover:bg-accent/90'
            }`}
            onClick={handleAdd}
            disabled={isOutOfStock || disabled}
            aria-label={`${name} ${t('addToCart')}`}
          >
            <AnimatePresence mode="wait">
              {added ? (
                <motion.span
                  key="added"
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  className="flex items-center gap-2"
                >
                  <Check className="h-5 w-5" />
                  {t('added')}
                </motion.span>
              ) : isOutOfStock ? (
                <motion.span key="oos">{t('outOfStock')}</motion.span>
              ) : (
                <motion.span
                  key="add"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  className="flex items-center gap-2"
                >
                  <ShoppingBag className="h-5 w-5" />
                  {t('addToCart')}
                </motion.span>
              )}
            </AnimatePresence>
          </Button>
        </motion.div>

        {/* Wishlist */}
        <WishlistButton productId={productId} />
      </div>
    </div>
  )
}

// ── Sticky Mobile Bar ───────────────────────────────────────

export function StickyAddToCart({
  name, price, onAdd, isOutOfStock,
}: {
  name: string; price: number; onAdd: () => void; isOutOfStock: boolean
}) {
  const t = useTranslations('product')

  return (
    <div className="fixed bottom-16 left-0 right-0 z-40 backdrop-blur-xl bg-background/80 border-t border-border/50 px-4 py-3 lg:hidden safe-bottom">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{name}</p>
          <p className="text-sm font-bold tabular-nums">&euro;{price.toFixed(2)}</p>
        </div>
        <Button onClick={onAdd} disabled={isOutOfStock} className="flex-shrink-0 gap-2 btn-press">
          <ShoppingBag className="h-4 w-4" />
          {isOutOfStock ? t('outOfStock') : t('addToCart')}
        </Button>
      </div>
    </div>
  )
}

// ── Wishlist Button (used on PDP) ───────────────────────

function WishlistButton({ productId }: { productId: string }) {
  const t = useTranslations('product')
  const { isInWishlist, toggle, isPending, isAuthenticated } = useWishlist()
  const wishlisted = isInWishlist(productId)
  const [pop, setPop] = useState(false)

  const handleClick = () => {
    if (!isAuthenticated || isPending) return
    setPop(true)
    toggle(productId)
    setTimeout(() => setPop(false), 450)
  }

  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={handleClick}
      className={`h-11 w-11 flex items-center justify-center border rounded-xl transition-all duration-200 flex-shrink-0 ${
        wishlisted ? 'bg-red-50 border-red-200' : 'hover:bg-muted'
      } ${pop ? 'animate-heart-pop' : ''}`}
      aria-label={t('addToWishlist')}
    >
      <Heart className={`h-5 w-5 transition-all duration-200 ${wishlisted ? 'fill-red-500 text-red-500 scale-110' : ''}`} />
    </motion.button>
  )
}
