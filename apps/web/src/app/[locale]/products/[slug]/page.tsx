'use client'

import { useTranslations, useLocale } from 'next-intl'
import { useSearchParams, useRouter } from 'next/navigation'
import { useEffect, useMemo, useCallback } from 'react'
import { ChevronRight, Share2, Truck } from 'lucide-react'
import Link from 'next/link'
import { useProduct, useFeaturedProducts } from '@/hooks/use-products'
import { useRecentlyViewed } from '@/hooks/use-recently-viewed'
import { useCartStore } from '@/store/cart-store'
import { ImageGallery } from '@/components/product/image-gallery'
import { VariantSelector } from '@/components/product/variant-selector'
import { AddToCart, StickyAddToCart } from '@/components/product/add-to-cart'
import { ProductTabs } from '@/components/product/product-tabs'
import { ProductCard } from '@/components/product/product-card'

export default function ProductDetailPage({
  params: { slug },
}: {
  params: { slug: string; locale: string }
}) {
  const t = useTranslations('product')
  const tHome = useTranslations('home')
  const currentLocale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: product, isLoading } = useProduct(slug)
  const { addItem: addToRecentlyViewed, items: recentItems } = useRecentlyViewed()
  const addCartItem = useCartStore((s) => s.addItem)

  // Selected variant from URL or first active
  const selectedVariantId = searchParams.get('variant')
  const selectedVariant = useMemo(() => {
    if (!product?.variants) return null
    return (
      product.variants.find((v) => v.id === selectedVariantId) ??
      product.variants.find((v) => v.isActive) ??
      product.variants[0]
    )
  }, [product, selectedVariantId])

  // Track recently viewed
  useEffect(() => {
    if (!product) return
    const pp = product as any
    const name = pp.name
      ?? product.translations?.find((tr) => tr.language === currentLocale)?.name
      ?? product.translations?.[0]?.name ?? product.slug
    const img = product.images?.find((i) => i.isPrimary)?.url ?? product.images?.[0]?.url ?? pp.imageUrl
    addToRecentlyViewed({
      id: product.id,
      slug: product.slug,
      name,
      price: Number(product.salePrice ?? product.basePrice),
      imageUrl: img,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id])

  const handleVariantSelect = useCallback((variantId: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('variant', variantId)
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [searchParams, router])

  // Loading skeleton
  if (isLoading || !product) {
    return (
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
          <div className="animate-pulse aspect-square rounded-lg bg-muted" />
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-muted rounded w-1/3" />
            <div className="h-8 bg-muted rounded w-2/3" />
            <div className="h-6 bg-muted rounded w-1/4" />
            <div className="h-12 bg-muted rounded w-full mt-8" />
          </div>
        </div>
      </div>
    )
  }

  const p = product as any
  const name = p.name
    ?? product.translations?.find((tr) => tr.language === currentLocale)?.name
    ?? product.translations?.[0]?.name ?? product.slug
  const description = p.description
    ?? product.translations?.find((tr) => tr.language === currentLocale)?.description
    ?? product.translations?.[0]?.description ?? ''
  const categoryName = product.category?.translations?.find((tr: any) => tr.language === currentLocale)?.name
    ?? product.category?.translations?.[0]?.name
    ?? (product.category as any)?.name

  const price = product.salePrice ?? product.basePrice
  const hasDiscount = product.salePrice && Number(product.salePrice) < Number(product.basePrice)
  const discountPercent = hasDiscount
    ? Math.round((1 - Number(product.salePrice) / Number(product.basePrice)) * 100)
    : 0

  const available = (selectedVariant as any)?._stock?.available ?? 1
  const images = product.images?.map((img) => ({ url: img.url, altText: img.altText ?? undefined })) ?? []

  // Estimated delivery: today + 3 business days (skip weekends)
  const estimatedDelivery = (() => {
    const d = new Date()
    let days = 3
    while (days > 0) {
      d.setDate(d.getDate() + 1)
      if (d.getDay() !== 0 && d.getDay() !== 6) days--
    }
    return d.toLocaleDateString(currentLocale === 'de' ? 'de-DE' : currentLocale === 'ar' ? 'ar' : 'en-GB', {
      weekday: 'short', day: 'numeric', month: 'long',
    })
  })()

  const handleStickyAdd = () => {
    if (!selectedVariant || available <= 0) return
    addCartItem({
      variantId: selectedVariant.id,
      productId: product.id,
      name,
      sku: selectedVariant.sku,
      color: selectedVariant.color,
      size: selectedVariant.size,
      imageUrl: images[0]?.url,
      unitPrice: Number(price),
      quantity: 1,
    })
  }

  // Tabs
  const tabs = [
    {
      id: 'description',
      label: t('description'),
      content: (
        <div className="prose prose-sm max-w-none text-muted-foreground">
          {description ? <p>{description}</p> : <p className="italic">{t('noDescription')}</p>}
        </div>
      ),
    },
    {
      id: 'shipping',
      label: t('shippingAndReturns'),
      content: (
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>{t('shippingInfo')}</p>
          <p>{t('freeShippingInfo')}</p>
          <p>{t('returnInfo')}</p>
          <p>{t('freeReturnInfo')}</p>
        </div>
      ),
    },
    {
      id: 'sizeGuide',
      label: t('sizeGuide'),
      content: (
        <p className="text-sm text-muted-foreground italic">
          {t('sizeGuideComingSoon')}
        </p>
      ),
    },
    {
      id: 'reviews',
      label: t('reviews'),
      content: (
        <p className="text-sm text-muted-foreground italic">{t('noReviews')}</p>
      ),
    },
  ]

  return (
    <>
      {/* JSON-LD Product Schema */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Product',
            name,
            image: images[0]?.url,
            description: description?.slice(0, 160),
            sku: selectedVariant?.sku,
            offers: {
              '@type': 'Offer',
              price: Number(price).toFixed(2),
              priceCurrency: 'EUR',
              availability: available > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
              seller: { '@type': 'Organization', name: 'Malak' },
            },
          }),
        }}
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-6 overflow-x-auto bg-muted/30 py-2 rounded-lg px-3">
          <Link href={`/${currentLocale}`} className="hover:text-foreground whitespace-nowrap">Home</Link>
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 rtl-flip" />
          {categoryName && (
            <>
              <Link href={`/${currentLocale}/products?category=${product.category?.translations?.[0]?.name}`} className="hover:text-foreground whitespace-nowrap">
                {categoryName}
              </Link>
              <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 rtl-flip" />
            </>
          )}
          <span className="text-foreground font-medium truncate">{name}</span>
        </nav>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
          {/* Left: Gallery */}
          <ImageGallery images={images} productName={name} />

          {/* Right: Info */}
          <div className="space-y-6">
            {/* Title */}
            <div>
              {categoryName && (
                <p className="text-sm text-muted-foreground mb-1">{categoryName}</p>
              )}
              <h1 className="text-2xl sm:text-3xl font-bold">{name}</h1>
            </div>

            {/* Price */}
            <div className="flex items-baseline gap-3">
              <span className={`text-3xl font-bold ${hasDiscount ? 'text-accent' : ''}`}>
                &euro;{Number(price).toFixed(2)}
              </span>
              {hasDiscount && (
                <>
                  <span className="text-lg text-muted-foreground line-through">
                    &euro;{Number(product.basePrice).toFixed(2)}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-destructive text-destructive-foreground text-xs font-semibold">
                    -{discountPercent}%
                  </span>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground -mt-4">
              {t('priceIncludesVat', { rate: Number(product.taxRate).toFixed(0) })}
            </p>

            {/* Availability */}
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${
                available > 5 ? 'bg-green-500' : available > 0 ? 'bg-orange-500 animate-pulse' : 'bg-red-500'
              }`} />
              <span className="text-sm font-medium">
                {available > 5
                  ? t('inStock')
                  : available > 0
                    ? t('lowStock', { count: available })
                    : t('outOfStock')}
              </span>
            </div>

            {/* Estimated Delivery */}
            {available > 0 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Truck className="h-4 w-4" />
                <span>{t('deliveryEstimate')} <strong className="text-foreground">{estimatedDelivery}</strong></span>
              </div>
            )}

            {/* Variants */}
            {product.variants && product.variants.length > 1 && (
              <VariantSelector
                variants={product.variants as any}
                selectedVariantId={selectedVariant?.id ?? null}
                onSelect={handleVariantSelect}
              />
            )}

            {/* Add to Cart */}
            <div className="border-t pt-6" />
            {selectedVariant && (
              <AddToCart
                variantId={selectedVariant.id}
                productId={product.id}
                name={name}
                sku={selectedVariant.sku}
                color={selectedVariant.color}
                size={selectedVariant.size}
                imageUrl={images[0]?.url}
                price={Number(price)}
                available={available}
              />
            )}

            {/* Share */}
            <div className="flex items-center gap-3 pt-2">
              <span className="text-sm text-muted-foreground">{t('share')}:</span>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`${name} — €${Number(price).toFixed(2)} ${typeof window !== 'undefined' ? window.location.href : ''}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="h-9 px-4 rounded-full border flex items-center justify-center hover:bg-muted transition-all duration-200 text-sm font-bold text-green-600"
                aria-label="WhatsApp"
              >
                W
              </a>
              <button
                onClick={() => {
                  if (typeof navigator !== 'undefined') {
                    navigator.clipboard.writeText(window.location.href)
                  }
                }}
                className="h-9 px-4 rounded-full border flex items-center justify-center hover:bg-muted transition-all duration-200"
                aria-label={t('copyLink')}
              >
                <Share2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-12 bg-muted/20 rounded-2xl p-6">
          <ProductTabs tabs={tabs} />
        </div>

        {/* Similar Products */}
        <SimilarProducts
          categorySlug={product.category?.translations?.[0]?.name}
          excludeId={product.id}
          locale={currentLocale}
        />

        {/* Recently Viewed */}
        {recentItems.length > 1 && (
          <section className="mt-12">
            <h2 className="text-xl font-bold mb-4">{tHome('recentlyViewed')}</h2>
            <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide -mx-4 px-4">
              {recentItems
                .filter((r) => r.id !== product.id)
                .map((item) => (
                  <Link
                    key={item.id}
                    href={`/${currentLocale}/products/${item.slug}`}
                    className="flex-shrink-0 w-[160px] snap-start group"
                  >
                    <div className="aspect-square rounded-lg bg-muted overflow-hidden relative">
                      {item.imageUrl && (
                        <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                      )}
                    </div>
                    <p className="mt-2 text-sm font-medium truncate group-hover:text-primary">{item.name}</p>
                    <p className="text-sm font-bold">&euro;{item.price.toFixed(2)}</p>
                  </Link>
                ))}
            </div>
          </section>
        )}
      </div>

      {/* Mobile Sticky Add to Cart */}
      <StickyAddToCart
        name={name}
        price={Number(price)}
        onAdd={handleStickyAdd}
        isOutOfStock={available <= 0}
      />
    </>
  )
}

// ── Similar Products ────────────────────────────────────────

function SimilarProducts({ excludeId }: {
  categorySlug?: string; excludeId: string; locale: string
}) {
  const tHome = useTranslations('home')
  const { data: products, isLoading } = useFeaturedProducts('newest', 8)
  // In production: use category filter + exclude current product
  const filtered = products?.filter((p) => p.id !== excludeId).slice(0, 8) ?? []

  if (isLoading || filtered.length === 0) return null

  return (
    <section className="mt-12">
      <h2 className="text-xl font-bold mb-4">{tHome('alsoLike')}</h2>
      <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide -mx-4 px-4">
        {filtered.map((product) => (
          <div key={product.id} className="flex-shrink-0 w-[200px] sm:w-[240px] snap-start">
            <ProductCard product={product} />
          </div>
        ))}
      </div>
    </section>
  )
}
