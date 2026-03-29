'use client'

import { useMemo, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Share2 } from 'lucide-react'
import { useCartStore } from '@/store/cart-store'
import { ImageGallery } from '@/components/product/image-gallery'
import { VariantSelector } from '@/components/product/variant-selector'
import { AddToCart, StickyAddToCart } from '@/components/product/add-to-cart'

interface ProductClientProps {
  product: any
  locale: string
  translations: Record<string, string>
}

export function ProductClient({ product, translations: t }: ProductClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const addCartItem = useCartStore((s) => s.addItem)

  // Selected variant from URL
  const selectedVariantId = searchParams.get('variant')
  const selectedVariant = useMemo(() => {
    if (!product?.variants) return null
    return (
      product.variants.find((v: any) => v.id === selectedVariantId) ??
      product.variants.find((v: any) => v.isActive) ??
      product.variants[0]
    )
  }, [product, selectedVariantId])

  const handleVariantSelect = useCallback((variantId: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('variant', variantId)
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [searchParams, router])

  const name = product.name ?? product.translations?.[0]?.name ?? product.slug
  const price = product.salePrice ?? product.basePrice
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
      unitPrice: Number(price), quantity: 1,
    })
  }

  return (
    <>
      {/* Image Gallery — replaces the server-rendered static image */}
      {images.length > 1 && (
        <div className="lg:hidden -mx-4 sm:mx-0 mb-6">
          <ImageGallery images={images} productName={name} />
        </div>
      )}

      {/* Desktop: Replace static image with interactive gallery */}
      {images.length > 1 && (
        <style>{`
          @media (min-width: 1024px) {
            #gallery-mount + div { display: none; }
          }
        `}</style>
      )}

      {/* Availability */}
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${
          available > 5 ? 'bg-green-500' : available > 0 ? 'bg-orange-500 animate-pulse' : 'bg-red-500'
        }`} />
        <span className="text-sm font-medium">
          {available > 5 ? t.inStock : available > 0 ? `${t.lowStock.replace('{count}', String(available))}` : t.outOfStock}
        </span>
      </div>

      {/* Variant Selector */}
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
          price={Number(price)} available={available}
        />
      )}

      {/* Share */}
      <div className="flex items-center gap-3 pt-2">
        <span className="text-sm text-muted-foreground">{t.share}:</span>
        <a href={`https://wa.me/?text=${encodeURIComponent(`${name} — €${Number(price).toFixed(2)} ${typeof window !== 'undefined' ? window.location.href : ''}`)}`}
          target="_blank" rel="noopener noreferrer" aria-label="WhatsApp"
          className="h-9 px-4 rounded-full border flex items-center justify-center hover:bg-muted transition-all text-sm font-bold text-green-600">W</a>
        <button onClick={() => { if (typeof navigator !== 'undefined') navigator.clipboard.writeText(window.location.href) }}
          className="h-9 px-4 rounded-full border flex items-center justify-center hover:bg-muted transition-all" aria-label={t.copyLink}>
          <Share2 className="h-4 w-4" />
        </button>
      </div>

      {/* Mobile Sticky Bar */}
      <StickyAddToCart name={name} price={Number(price)} onAdd={handleStickyAdd} isOutOfStock={available <= 0} />
    </>
  )
}
