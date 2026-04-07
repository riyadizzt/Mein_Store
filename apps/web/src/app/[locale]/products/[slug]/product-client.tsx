'use client'

import { useMemo, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Share2, Truck, MessageCircle } from 'lucide-react'
import { useCartStore } from '@/store/cart-store'
import { ImageGallery } from '@/components/product/image-gallery'
import { VariantSelector } from '@/components/product/variant-selector'
import { AddToCart, StickyAddToCart } from '@/components/product/add-to-cart'
import { trackMetaEvent, trackTikTokEvent } from '@/components/tracking-pixels'
import { NotifyWhenAvailable } from '@/components/product/notify-when-available'
import { RelatedProducts } from '@/components/product/related-products'
import { getWhatsAppShareUrl } from '@/components/whatsapp-button'

interface ProductClientProps {
  product: any
  locale: string
  translations: Record<string, string>
  computed: {
    name: string
    description: string
    categoryName: string | undefined
    price: number
    hasDiscount: boolean
    discountPercent: number
    deliveryDate: string
    basePrice: number
  }
}

export function ProductClient({ product, locale, translations: t, computed }: ProductClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const addCartItem = useCartStore((s) => s.addItem)

  const { name, description, categoryName, price: serverPrice, hasDiscount: serverHasDiscount, deliveryDate, basePrice: serverBasePrice } = computed

  // Current URL for sharing (safe for SSR)
  const [currentUrl, setCurrentUrl] = useState('')
  useEffect(() => { setCurrentUrl(window.location.href) }, [])

  // Track ViewContent on mount
  useEffect(() => {
    const eventData = {
      content_name: name,
      content_ids: [product.id],
      content_type: 'product',
      value: serverPrice,
      currency: 'EUR',
    }
    trackMetaEvent('ViewContent', eventData)
    trackTikTokEvent('ViewContent', eventData)
  }, [product.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Selected variant
  const selectedVariantId = searchParams.get('variant')
  const selectedVariant = useMemo(() => {
    if (!product?.variants) return null
    return (
      product.variants.find((v: any) => v.id === selectedVariantId) ??
      product.variants.find((v: any) => v.isActive && v.stock > 0) ??
      product.variants.find((v: any) => v.isActive) ??
      product.variants[0]
    )
  }, [product, selectedVariantId])

  // Dynamic price: base + variant priceModifier
  const modifier = Number(selectedVariant?.priceModifier ?? 0)
  const basePrice = Math.max(0, serverBasePrice + modifier)
  const price = serverHasDiscount ? Math.max(0, serverPrice + modifier) : basePrice
  const hasDiscount = serverHasDiscount && price < basePrice
  const discountPercent = hasDiscount && basePrice > 0 ? Math.round((1 - price / basePrice) * 100) : 0

  const handleVariantSelect = useCallback((variantId: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('variant', variantId)
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [searchParams, router])

  const available = (selectedVariant as any)?.stock ?? 0
  const selectedColor = selectedVariant?.color

  // Filter images by selected color
  const allImages = product.images ?? []
  const colorImages = selectedColor ? allImages.filter((img: any) => img.colorName === selectedColor) : []
  const generalImages = allImages.filter((img: any) => !img.colorName)
  const displayImages = colorImages.length > 0 ? [...colorImages, ...generalImages] : allImages
  const images = displayImages.map((img: any) => ({ url: img.url, altText: img.altText ?? undefined }))

  const handleStickyAdd = () => {
    if (!selectedVariant || available <= 0) return
    addCartItem({
      variantId: selectedVariant.id, productId: product.id, name,
      sku: selectedVariant.sku, color: selectedVariant.color,
      size: selectedVariant.size, imageUrl: images[0]?.url,
      unitPrice: price, quantity: 1,
    })
  }

  return (
    <>
      {/* Main Grid: Gallery left, Info right */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
        {/* Left: Image Gallery — ONE place, no duplicates */}
        <ImageGallery images={images} productName={name} />

        {/* Right: Product Info */}
        <div className="space-y-6">
          {categoryName && <p className="text-sm text-muted-foreground">{categoryName}</p>}
          <h1 className="text-2xl sm:text-3xl font-bold">{name}</h1>

          {/* Price */}
          <div className="flex items-baseline gap-3">
            <span className={`text-3xl font-bold ${hasDiscount ? 'text-accent' : ''}`}>
              &euro;{price.toFixed(2)}
            </span>
            {hasDiscount && (
              <>
                <span className="text-lg text-muted-foreground line-through">&euro;{basePrice.toFixed(2)}</span>
                <span className="px-2 py-0.5 rounded bg-destructive text-destructive-foreground text-xs font-semibold">-{discountPercent}%</span>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground -mt-4">{t.priceIncludesVat}</p>

          {/* Stock */}
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${
              available > 5 ? 'bg-green-500' : available > 0 ? 'bg-orange-500 animate-pulse' : 'bg-red-500'
            }`} />
            <span className="text-sm font-medium">
              {available > 5 ? t.inStock : available > 0 ? `${t.inStock} (${available})` : t.outOfStock}
            </span>
          </div>

          {/* No-Return Notice */}
          {product.excludeFromReturns && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-orange-500/10 border border-orange-500/20 text-sm">
              <svg className="h-4 w-4 mt-0.5 flex-shrink-0 text-orange-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <div>
                <p className="font-medium text-orange-700 dark:text-orange-400">
                  {locale === 'ar' ? 'مستثنى من حق الإرجاع' : locale === 'en' ? 'Excluded from returns' : 'Vom Umtausch ausgeschlossen'}
                </p>
                {product.returnExclusionReason && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {product.returnExclusionReason === 'hygiene'
                      ? (locale === 'ar' ? 'منتج صحي / نظافة' : locale === 'en' ? 'Hygiene product' : 'Hygieneartikel')
                      : product.returnExclusionReason === 'custom_made'
                        ? (locale === 'ar' ? 'مصنوع حسب الطلب' : locale === 'en' ? 'Custom made' : 'Maßanfertigung')
                        : product.returnExclusionReason === 'sealed'
                          ? (locale === 'ar' ? 'بضاعة مختومة' : locale === 'en' ? 'Sealed product' : 'Versiegelte Ware')
                          : ''}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Delivery */}
          {available > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Truck className="h-4 w-4" />
              <span>{t.deliveryEstimate} <strong className="text-foreground">{deliveryDate}</strong></span>
            </div>
          )}

          {/* Variants */}
          {product.variants && product.variants.length > 1 && (
            <VariantSelector
              variants={product.variants}
              selectedVariantId={selectedVariant?.id ?? null}
              onSelect={handleVariantSelect}
            />
          )}

          {/* Add to Cart */}
          <div className="border-t pt-6" />
          {selectedVariant && (
            <AddToCart
              variantId={selectedVariant.id} productId={product.id} name={name}
              sku={selectedVariant.sku} color={selectedVariant.color}
              size={selectedVariant.size} imageUrl={images[0]?.url}
              price={price} available={available}
            />
          )}

          {/* Notify when back in stock */}
          {available <= 0 && selectedVariant && (
            <NotifyWhenAvailable productId={product.id} variantId={selectedVariant.id} locale={locale} />
          )}

          {/* Share */}
          <div className="flex items-center gap-3 pt-2">
            <span className="text-sm text-muted-foreground">{t.share}:</span>
            <a
              href={currentUrl ? getWhatsAppShareUrl(name, `€${price.toFixed(2)}`, currentUrl, locale) : '#'}
              target="_blank" rel="noopener noreferrer" aria-label="WhatsApp"
              className="h-9 px-4 rounded-full border flex items-center gap-2 justify-center hover:bg-green-50 hover:border-green-300 transition-all text-sm font-medium text-green-600"
            >
              <MessageCircle className="h-4 w-4" />
              WhatsApp
            </a>
            <button onClick={() => { if (typeof navigator !== 'undefined') navigator.clipboard.writeText(window.location.href) }}
              className="h-9 px-4 rounded-full border flex items-center justify-center hover:bg-muted transition-all" aria-label={t.copyLink}>
              <Share2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="mt-12 bg-muted/20 rounded-2xl p-6">
        <h2 className="text-lg font-bold mb-4">{t.description}</h2>
        <div className="prose prose-sm max-w-none text-muted-foreground">
          {description ? <p>{description}</p> : <p className="italic">{t.noDescription}</p>}
        </div>
      </div>

      {/* Related Products */}
      <RelatedProducts productId={product.id} categoryId={product.categoryId} locale={locale} />

      {/* Mobile Sticky Bar */}
      <StickyAddToCart name={name} price={price} onAdd={handleStickyAdd} isOutOfStock={available <= 0} />
    </>
  )
}
