'use client'

import { useTranslations, useLocale } from 'next-intl'
import Image from 'next/image'
import Link from 'next/link'
import { Heart, ShoppingBag } from 'lucide-react'
import { useState } from 'react'
import { useCartStore } from '@/store/cart-store'
import { useWishlist } from '@/hooks/use-wishlist'
import type { Product } from '@/hooks/use-products'

interface ProductCardProps {
  product: Product
}

export function ProductCard({ product }: ProductCardProps) {
  const t = useTranslations('product')
  const locale = useLocale()
  const [isHovered, setIsHovered] = useState(false)
  const addItem = useCartStore((s) => s.addItem)
  const { isInWishlist, toggle: toggleWishlist, isPending: wishlistPending, isAuthenticated } = useWishlist()

  const wishlisted = isInWishlist(product.id)

  const p = product as any
  const name = p.name
    ?? product.translations?.find((tr) => tr.language === locale)?.name
    ?? product.translations?.[0]?.name
    ?? product.slug

  const primaryImage = product.images?.find((img) => img.isPrimary) ?? product.images?.[0]
  const imageUrl = primaryImage?.url ?? p.imageUrl
  const secondImage = product.images?.find((img) => !img.isPrimary && img.sortOrder === 1)

  const price = product.salePrice ?? product.basePrice
  const hasDiscount = product.salePrice && Number(product.salePrice) < Number(product.basePrice)
  const available = p.totalStock ?? product._stock?.available ?? 1

  const firstVariant = product.variants?.[0]

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!firstVariant || available <= 0) return
    // Build locale name map from translations
    const names: Record<string, string> = {}
    for (const tr of product.translations ?? []) {
      if (tr.name) names[tr.language] = tr.name
    }
    if (p.name && !names[locale]) names[locale] = p.name

    addItem({
      variantId: firstVariant.id,
      productId: product.id,
      name,
      names,
      sku: firstVariant.sku,
      color: firstVariant.color,
      size: firstVariant.size,
      imageUrl: primaryImage?.url,
      unitPrice: Number(price),
      quantity: 1,
    })
  }

  return (
    <Link
      href={`/${locale}/products/${product.slug}`}
      className="group block"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      prefetch={false}
    >
      {/* Image Container — Premium hover effects */}
      <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-muted shadow-card transition-all duration-300 group-hover:shadow-card-hover">
        {imageUrl ? (
          <>
            <Image
              src={imageUrl}
              alt={primaryImage?.altText ?? name}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className={`object-cover transition-all duration-500 group-hover:scale-105 ${
                isHovered && secondImage ? 'opacity-0' : 'opacity-100'
              }`}
            />
            {secondImage && (
              <Image
                src={secondImage.url}
                alt={name}
                fill
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                className={`object-cover absolute inset-0 transition-all duration-500 scale-105 ${
                  isHovered ? 'opacity-100' : 'opacity-0'
                }`}
              />
            )}
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/50">
            <span className="text-3xl font-bold text-muted-foreground/20">{name.charAt(0)}</span>
          </div>
        )}

        {/* Wishlist Heart — animated */}
        <button
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (!isAuthenticated || wishlistPending) return
            toggleWishlist(product.id)
          }}
          className="absolute top-3 right-3 rtl:right-auto rtl:left-3 h-9 w-9 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center sm:opacity-0 sm:group-hover:opacity-100 transition-all duration-200 hover:bg-white hover:scale-110 shadow-sm"
          aria-label="Wishlist"
        >
          <Heart className={`h-4 w-4 transition-colors ${wishlisted ? 'fill-red-500 text-red-500' : ''}`} />
        </button>

        {/* Sale Badge — premium */}
        {hasDiscount && (
          <span className="absolute top-3 left-3 rtl:left-auto rtl:right-3 px-3 py-1 rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold tracking-wide uppercase shadow-sm">
            Sale
          </span>
        )}

        {/* Add to Cart — smooth slide-up */}
        {available > 0 && (
          <button
            onClick={handleAddToCart}
            className="absolute bottom-0 left-0 right-0 h-11 bg-foreground/95 backdrop-blur-sm text-background text-sm font-medium flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-full group-hover:translate-y-0"
          >
            <ShoppingBag className="h-4 w-4" />
            {t('addToCart')}
          </button>
        )}
      </div>

      {/* Info — clean typography */}
      <div className="mt-4 space-y-1.5">
        <h3 className="text-sm font-medium line-clamp-2 leading-snug group-hover:text-accent transition-colors duration-200">
          {name}
        </h3>

        <div className="flex items-baseline gap-2">
          <span className="text-base font-bold">&euro;{Number(price).toFixed(2)}</span>
          {hasDiscount && (
            <span className="text-sm text-muted-foreground line-through">
              &euro;{Number(product.basePrice).toFixed(2)}
            </span>
          )}
        </div>

        {/* Availability */}
        <div className="flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${
              available > 0 ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <span className="text-xs text-muted-foreground">
            {available > 0
              ? available <= 3
                ? t('lowStock', { count: available })
                : t('inStock')
              : t('outOfStock')}
          </span>
        </div>
      </div>
    </Link>
  )
}

// ── Skeleton ─────────────────────────────────────────────────

export function ProductCardSkeleton() {
  return (
    <div>
      <div className="aspect-[3/4] rounded-xl animate-shimmer" />
      <div className="mt-4 space-y-2">
        <div className="h-4 animate-shimmer rounded-full w-3/4" />
        <div className="h-5 animate-shimmer rounded-full w-1/3" />
        <div className="h-3 animate-shimmer rounded-full w-1/2" />
      </div>
    </div>
  )
}
