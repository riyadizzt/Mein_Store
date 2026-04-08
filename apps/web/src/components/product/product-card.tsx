'use client'

import { useTranslations, useLocale } from 'next-intl'
import Image from 'next/image'
import Link from 'next/link'
import { Heart, ShoppingBag } from 'lucide-react'
import { useState } from 'react'
import { useCartStore } from '@/store/cart-store'
import { useWishlist } from '@/hooks/use-wishlist'
import { toast } from '@/store/toast-store'
import type { Product } from '@/hooks/use-products'

interface ProductCardProps {
  product: Product
  priority?: boolean
}

export function ProductCard({ product, priority = false }: ProductCardProps) {
  const t = useTranslations('product')
  const locale = useLocale()
  const [isHovered, setIsHovered] = useState(false)
  const [heartPop, setHeartPop] = useState(false)
  const addItem = useCartStore((s) => s.addItem)
  const {
    isInWishlist,
    toggle: toggleWishlist,
    isPending: wishlistPending,
    isAuthenticated,
  } = useWishlist()

  const wishlisted = isInWishlist(product.id)

  const p = product as any
  const name =
    p.name ??
    product.translations?.find((tr) => tr.language === locale)?.name ??
    product.translations?.[0]?.name ??
    product.slug

  const primaryImage =
    product.images?.find((img) => img.isPrimary) ?? product.images?.[0]
  const imageUrl = primaryImage?.url ?? p.imageUrl
  const secondImage = product.images?.find(
    (img) => !img.isPrimary && img.sortOrder === 1,
  )

  const price = product.salePrice ?? product.basePrice
  const hasDiscount =
    product.salePrice && Number(product.salePrice) < Number(product.basePrice)
  const available = p.totalStock ?? product._stock?.available ?? 1

  const firstVariant = product.variants?.[0]

  const discountPercent = hasDiscount
    ? Math.round(
        ((Number(product.basePrice) - Number(product.salePrice)) /
          Number(product.basePrice)) *
          100,
      )
    : 0

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!firstVariant) {
      // Keine Variante im Listen-Response → zur PDP navigieren
      window.location.href = `/${locale}/products/${product.slug}`
      return
    }
    if (available <= 0) return
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
    toast.success(t('addedToCart'))
  }

  const handleWishlist = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!isAuthenticated || wishlistPending) return
    setHeartPop(true)
    toggleWishlist(product.id)
    setTimeout(() => setHeartPop(false), 450)
  }

  return (
    <Link
      href={`/${locale}/products/${product.slug}`}
      className="group block"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      prefetch={false}
      aria-label={name}
    >
      {/* Image Container */}
      <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-muted shadow-card transition-all duration-300 group-hover:shadow-card-hover group-hover:-translate-y-1">
        {imageUrl ? (
          <>
            <Image
              src={imageUrl}
              alt={primaryImage?.altText ?? name}
              fill
              priority={priority}
              loading={priority ? 'eager' : 'lazy'}
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className={`object-cover transition-all duration-500 will-change-transform group-hover:scale-105 ${
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
            <span className="text-3xl font-bold text-muted-foreground/20">
              {name.charAt(0)}
            </span>
          </div>
        )}

        {/* Wishlist Heart — animated with pop on toggle */}
        <button
          onClick={handleWishlist}
          className={`absolute top-3 right-3 rtl:right-auto rtl:left-3 h-9 w-9 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center sm:opacity-0 sm:group-hover:opacity-100 transition-all duration-200 hover:bg-white shadow-sm ${
            heartPop ? 'animate-heart-pop' : ''
          } ${wishlisted ? 'sm:opacity-100' : ''}`}
          aria-label="Wishlist"
        >
          <Heart
            className={`h-4 w-4 transition-all duration-200 ${
              wishlisted
                ? 'fill-red-500 text-red-500 scale-110'
                : 'hover:scale-110'
            }`}
          />
        </button>

        {/* Badges — Sale / New / Bestseller */}
        <div className="absolute top-3 left-3 rtl:left-auto rtl:right-3 flex flex-col gap-1.5">
          {hasDiscount && (
            <span className="px-2.5 py-1 rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold tracking-wide uppercase shadow-sm animate-sale-pulse">
              -{discountPercent}%
            </span>
          )}
          {p.isFeatured && !hasDiscount && (
            <span className="px-2.5 py-1 rounded-full bg-brand-gold text-white text-[10px] font-bold tracking-wide uppercase shadow-sm">
              {locale === 'ar' ? 'مميز' : 'Best'}
            </span>
          )}
        </div>

        {/* Add to Cart — smooth slide-up with icon */}
        {available > 0 && (
          <button
            onClick={handleAddToCart}
            aria-label={`${name} ${t('addToCart')}`}
            className="absolute bottom-0 left-0 right-0 h-11 bg-foreground/95 backdrop-blur-sm text-background text-sm font-medium flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-full group-hover:translate-y-0 btn-press"
          >
            <ShoppingBag className="h-4 w-4" />
            {t('addToCart')}
          </button>
        )}
      </div>

      {/* Info */}
      <div className="mt-4 space-y-1.5">
        <h3 className="text-sm font-medium line-clamp-2 leading-snug group-hover:text-accent transition-colors duration-200">
          {name}
        </h3>

        <div className="flex items-baseline gap-2">
          <span className="text-base font-bold tabular-nums">
            &euro;{Number(price).toFixed(2)}
          </span>
          {hasDiscount && (
            <span className="text-sm text-muted-foreground line-through tabular-nums">
              &euro;{Number(product.basePrice).toFixed(2)}
            </span>
          )}
        </div>

        {/* Availability — with urgency for low stock */}
        {available <= 0 ? (
          <p className="text-xs text-destructive font-medium">{t('outOfStock')}</p>
        ) : available <= 3 ? (
          <p className="text-xs text-orange-600 font-medium flex items-center gap-1">
            <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute h-full w-full rounded-full bg-orange-400 opacity-75" /><span className="relative rounded-full h-1.5 w-1.5 bg-orange-500" /></span>
            {t('lowStock', { count: available })}
          </p>
        ) : null}
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
