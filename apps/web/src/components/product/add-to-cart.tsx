'use client'

import { useTranslations } from 'next-intl'
import { useState, useCallback } from 'react'
import { Minus, Plus, Heart, Check, ShoppingBag } from 'lucide-react'
import { useCartStore } from '@/store/cart-store'
import { useWishlist } from '@/hooks/use-wishlist'
import { Button } from '@/components/ui/button'

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

  const handleAdd = useCallback(() => {
    if (disabled || available <= 0) return
    setDisabled(true)

    addItem({
      variantId,
      productId,
      name,
      sku,
      color,
      size,
      imageUrl,
      unitPrice: price,
      quantity,
    })

    setAdded(true)
    setTimeout(() => {
      setAdded(false)
      setDisabled(false)
    }, 2000)
  }, [disabled, available, addItem, variantId, productId, name, sku, color, size, imageUrl, price, quantity])

  const isOutOfStock = available <= 0
  const maxQty = Math.min(available, 10)

  return (
    <div className="space-y-4">
      {/* Quantity + Add to Cart */}
      <div className="flex items-center gap-3">
        {/* Quantity Selector */}
        <div className="flex items-center border rounded-xl">
          <button
            onClick={() => setQuantity(Math.max(1, quantity - 1))}
            disabled={quantity <= 1}
            className="h-11 w-11 flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-40"
            aria-label="Decrease quantity"
          >
            <Minus className="h-4 w-4" />
          </button>
          <input
            type="number"
            min={1}
            max={maxQty}
            value={quantity}
            aria-label="Quantity"
            onChange={(e) => {
              const val = parseInt(e.target.value) || 1
              setQuantity(Math.max(1, Math.min(val, maxQty)))
            }}
            className="w-12 h-11 text-center text-sm font-medium bg-transparent border-x [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button
            onClick={() => setQuantity(Math.min(maxQty, quantity + 1))}
            disabled={quantity >= maxQty}
            className="h-11 w-11 flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-40"
            aria-label="Increase quantity"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {/* Add to Cart Button */}
        <Button
          size="lg"
          className="flex-1 h-13 text-base rounded-xl gap-2 bg-accent text-accent-foreground hover:bg-accent/90"
          onClick={handleAdd}
          disabled={isOutOfStock || disabled}
          aria-label={`${name} ${t('addToCart')}`}
        >
          {added ? (
            <>
              <Check className="h-5 w-5" />
              {t('added')}
            </>
          ) : isOutOfStock ? (
            t('outOfStock')
          ) : (
            <>
              <ShoppingBag className="h-5 w-5" />
              {t('addToCart')}
            </>
          )}
        </Button>

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
          <p className="text-sm font-bold">&euro;{price.toFixed(2)}</p>
        </div>
        <Button
          onClick={onAdd}
          disabled={isOutOfStock}
          className="flex-shrink-0 gap-2"
        >
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

  return (
    <button
      onClick={() => {
        if (!isAuthenticated || isPending) return
        toggle(productId)
      }}
      className={`h-11 w-11 flex items-center justify-center border rounded-xl transition-all duration-200 flex-shrink-0 ${
        wishlisted ? 'bg-red-50 border-red-200' : 'hover:bg-muted'
      }`}
      aria-label={t('addToWishlist')}
    >
      <Heart className={`h-5 w-5 transition-colors ${wishlisted ? 'fill-red-500 text-red-500' : ''}`} />
    </button>
  )
}
