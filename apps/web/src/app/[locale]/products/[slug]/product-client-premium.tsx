'use client'

import { useMemo, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import {
  Truck, Heart, MessageCircle, Minus, Plus,
  ShoppingBag, Check, Star, Copy,
} from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'

import { useCartStore } from '@/store/cart-store'
import { useWishlist } from '@/hooks/use-wishlist'
import { toast } from '@/store/toast-store'
import { trackMetaEvent, trackTikTokEvent } from '@/components/tracking-pixels'
import { getWhatsAppShareUrl } from '@/components/whatsapp-button'
import { translateColor } from '@/lib/locale-utils'
import { useActiveCampaign } from '@/hooks/use-campaign'
import { NotifyWhenAvailable } from '@/components/product/notify-when-available'

import { PremiumGallery } from '@/components/product/premium/premium-gallery'
import { PremiumTabs } from '@/components/product/premium/premium-tabs'
import { PremiumTrustBar } from '@/components/product/premium/premium-trust-bar'
import { PremiumRecentlyViewed, saveRecentlyViewed } from '@/components/product/premium/premium-recently-viewed'

// ────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────

interface PremiumPDPProps {
  product: any
  locale: string
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
  similarProducts: any[]
}

// ────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────

function getStock(v: any): number {
  return v?.stock ?? v?._stock?.available ?? 0
}

// ────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────

export function ProductClientPremium({ product, locale, computed, similarProducts }: PremiumPDPProps) {
  const t = useTranslations('product')
  const router = useRouter()
  const searchParams = useSearchParams()
  const addCartItem = useCartStore((s) => s.addItem)
  const openDrawer = useCartStore((s) => s.openDrawer)
  const { isInWishlist, toggle: toggleWishlist, isPending: wishPending, isAuthenticated } = useWishlist()
  const { campaign } = useActiveCampaign()

  const isRTL = locale === 'ar'
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  const { name, description, categoryName, deliveryDate, basePrice: serverBase } = computed

  // ── URL for sharing ──
  const [currentUrl, setCurrentUrl] = useState('')
  useEffect(() => { setCurrentUrl(window.location.href) }, [])

  // ── Track ViewContent ──
  useEffect(() => {
    const ev = { content_name: name, content_ids: [product.id], content_type: 'product', value: computed.price, currency: 'EUR' }
    trackMetaEvent('ViewContent', ev)
    trackTikTokEvent('ViewContent', ev)
  }, [product.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save to recently viewed ──
  useEffect(() => {
    const img = product.images?.find((i: any) => i.isPrimary)?.url ?? product.images?.[0]?.url ?? ''
    saveRecentlyViewed({ id: product.id, slug: product.slug, name, imageUrl: img, price: computed.price })
  }, [product.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Selected variant ──
  const selectedVariantId = searchParams.get('variant')
  const selectedVariant = useMemo(() => {
    if (!product?.variants) return null
    return (
      product.variants.find((v: any) => v.id === selectedVariantId) ??
      product.variants.find((v: any) => v.isActive && getStock(v) > 0) ??
      product.variants.find((v: any) => v.isActive) ??
      product.variants[0]
    )
  }, [product, selectedVariantId])

  // ── Dynamic pricing ──
  const modifier = Number(selectedVariant?.priceModifier ?? 0)
  const basePrice = Math.max(0, serverBase + modifier)
  const price = computed.hasDiscount ? Math.max(0, computed.price + modifier) : basePrice
  const hasDiscount = computed.hasDiscount && price < basePrice
  const discountPercent = hasDiscount && basePrice > 0 ? Math.round((1 - price / basePrice) * 100) : 0

  // ── Stock ──
  const available = getStock(selectedVariant)
  const selectedColor = selectedVariant?.color
  const selectedSize = selectedVariant?.size

  // ── Images filtered by color ──
  const allImages = product.images ?? []
  const colorImages = selectedColor ? allImages.filter((img: any) => img.colorName === selectedColor) : []
  const generalImages = allImages.filter((img: any) => !img.colorName)
  const displayImages = colorImages.length > 0 ? [...colorImages, ...generalImages] : allImages
  const images = displayImages.map((img: any) => ({ url: img.url, altText: img.altText ?? undefined }))

  // ── Variant extraction ──
  const variants = product.variants ?? []
  const colorMap = new Map<string, { color: string; hex: string }>()
  for (const v of variants.filter((v: any) => v.color)) {
    if (!colorMap.has(v.color)) colorMap.set(v.color, { color: v.color, hex: v.colorHex ?? '' })
  }
  const colors = [...colorMap.values()]
  const sizes: string[] = [...new Set<string>(variants.filter((v: any) => v.size).map((v: any) => v.size! as string))].sort((a, b) => {
    const na = parseFloat(a) || 0; const nb = parseFloat(b) || 0
    return na - nb || a.localeCompare(b)
  })

  const findVariant = (color?: string, size?: string) =>
    variants.find((v: any) => (color ? v.color === color : true) && (size ? v.size === size : true) && v.isActive)

  const isColorAvailable = (color: string) => {
    if (selectedSize) { const v = findVariant(color, selectedSize); return v ? getStock(v) > 0 : false }
    return variants.some((v: any) => v.color === color && v.isActive && getStock(v) > 0)
  }
  const isSizeAvailable = (size: string) => {
    if (selectedColor) { const v = findVariant(selectedColor, size); return v ? getStock(v) > 0 : false }
    return variants.some((v: any) => v.size === size && v.isActive && getStock(v) > 0)
  }

  const handleVariantSelect = useCallback((variantId: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('variant', variantId)
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [searchParams, router])

  // ── Cart ──
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)
  const [cartDisabled, setCartDisabled] = useState(false)
  const maxQty = Math.max(1, Math.min(available, 10))

  useEffect(() => { setQty(1); setAdded(false) }, [selectedVariant?.id])
  useEffect(() => { if (qty > maxQty) setQty(maxQty) }, [maxQty, qty])

  const handleAddToCart = useCallback(() => {
    if (cartDisabled || available <= 0 || !selectedVariant) return
    setCartDisabled(true)
    addCartItem({
      variantId: selectedVariant.id, productId: product.id, name, sku: selectedVariant.sku,
      color: selectedVariant.color, size: selectedVariant.size, imageUrl: images[0]?.url,
      unitPrice: price, quantity: Math.min(qty, available),
    })
    const ev = { content_name: name, content_ids: [product.id], content_type: 'product', value: price * qty, currency: 'EUR' }
    trackMetaEvent('AddToCart', ev); trackTikTokEvent('AddToCart', ev)
    setAdded(true)
    openDrawer()
    setTimeout(() => { setAdded(false); setCartDisabled(false) }, 2500)
  }, [cartDisabled, available, selectedVariant, addCartItem, product, name, images, price, qty, openDrawer])

  // ── Wishlist ──
  const wishlisted = isInWishlist(product.id)
  const [wishPop, setWishPop] = useState(false)
  const handleWishlist = () => {
    if (!isAuthenticated || wishPending) return
    setWishPop(true); toggleWishlist(product.id); setTimeout(() => setWishPop(false), 400)
  }

  // ── Share ──
  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    toast.success(t3('Link kopiert!', 'Link copied!', 'تم نسخ الرابط!'))
  }

  // ── Urgency: campaign OR low stock, never both ──
  const showCampaign = campaign && campaign.heroCountdown && new Date(campaign.endAt) > new Date()
  const showLowStock = !showCampaign && available > 0 && available <= 5

  // ── Campaign countdown ──
  const [countdown, setCountdown] = useState('')
  useEffect(() => {
    if (!showCampaign || !campaign) return
    const tick = () => {
      const diff = new Date(campaign.endAt).getTime() - Date.now()
      if (diff <= 0) { setCountdown(''); return }
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setCountdown(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [showCampaign, campaign])

  // ── Tabs content ──
  const tabs = [
    {
      id: 'description',
      label: t('description'),
      content: (
        <div className="text-sm font-light leading-relaxed text-[#0f1419]/60 max-w-2xl">
          {description ? <p>{description}</p> : <p className="italic text-[#0f1419]/25">{t('noDescription')}</p>}
        </div>
      ),
    },
    {
      id: 'details',
      label: t3('Details & Material', 'Details & Material', 'التفاصيل والمواد'),
      content: (
        <div className="text-sm font-light leading-relaxed text-[#0f1419]/60 max-w-2xl space-y-3">
          {selectedVariant?.sku && (
            <div className="flex gap-4"><span className="text-[#0f1419]/30 w-28 flex-shrink-0">{t3('Artikelnr.', 'SKU', 'رقم المنتج')}</span><span>{selectedVariant.sku}</span></div>
          )}
          {product.brand && (
            <div className="flex gap-4"><span className="text-[#0f1419]/30 w-28 flex-shrink-0">{t3('Marke', 'Brand', 'العلامة التجارية')}</span><span>{product.brand}</span></div>
          )}
          {categoryName && (
            <div className="flex gap-4"><span className="text-[#0f1419]/30 w-28 flex-shrink-0">{t3('Kategorie', 'Category', 'الفئة')}</span><span>{categoryName}</span></div>
          )}
          {selectedVariant?.color && (
            <div className="flex gap-4"><span className="text-[#0f1419]/30 w-28 flex-shrink-0">{t('color')}</span><span>{translateColor(selectedVariant.color, locale)}</span></div>
          )}
        </div>
      ),
    },
    {
      id: 'size',
      label: t3('Größe & Passform', 'Size & Fit', 'المقاس والتصميم'),
      content: (
        <div className="text-sm font-light leading-relaxed text-[#0f1419]/60 max-w-2xl">
          {product.sizeGuide ? (
            <div dangerouslySetInnerHTML={{ __html: product.sizeGuide }} />
          ) : (
            <p className="italic text-[#0f1419]/25">{t('sizeGuideComingSoon')}</p>
          )}
        </div>
      ),
    },
    {
      id: 'shipping',
      label: t('shippingAndReturns'),
      content: (
        <div className="text-sm font-light leading-relaxed text-[#0f1419]/60 max-w-2xl space-y-3">
          <p>{t('shippingInfo')}</p>
          <p>{t('freeShippingInfo')}</p>
          <div className="h-px bg-[#e5e5e5] my-4" />
          <p>{t('returnInfo')}</p>
          <p>{t('freeReturnInfo')}</p>
          {product.excludeFromReturns && (
            <p className="text-[#b45309] mt-4">
              {product.returnExclusionReason === 'hygiene'
                ? t3('Aus Hygienegründen kann dieser Artikel nach dem Öffnen nicht zurückgegeben werden.', 'For hygiene reasons, this product cannot be returned once opened.', 'لأسباب صحية، لا يمكن إرجاع هذا المنتج بعد فتحه.')
                : product.returnExclusionReason === 'custom_made'
                  ? t3('Maßanfertigungen sind vom Umtausch ausgeschlossen.', 'Custom-made items are non-returnable.', 'المنتجات المصنوعة حسب الطلب غير قابلة للإرجاع.')
                  : t3('Versiegelte Ware kann nach dem Öffnen nicht zurückgegeben werden.', 'Sealed items cannot be returned once opened.', 'المنتجات المختومة غير قابلة للإرجاع بعد فتحها.')}
            </p>
          )}
          <p className="mt-4">
            <Link href={`/${locale}/legal/widerruf`} className="underline underline-offset-4 decoration-[#0f1419]/20 hover:decoration-[#0f1419]/40 transition-colors">
              {t3('Widerrufsbelehrung', 'Cancellation policy', 'سياسة الإلغاء')}
            </Link>
          </p>
        </div>
      ),
    },
  ]

  // ── Sticky add-to-cart (mobile) ──
  const handleStickyAdd = () => {
    if (!selectedVariant || available <= 0) return
    addCartItem({
      variantId: selectedVariant.id, productId: product.id, name, sku: selectedVariant.sku,
      color: selectedVariant.color, size: selectedVariant.size, imageUrl: images[0]?.url,
      unitPrice: price, quantity: 1,
    })
    openDrawer()
    toast.success(t('added'))
  }

  // ────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────

  return (
    <div>
      {/* ═══════════════ MAIN GRID ═══════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 lg:gap-16 xl:gap-20">

        {/* ─── LEFT: Gallery (7 cols ≈ 58%) ─── */}
        <div className="lg:col-span-7">
          <PremiumGallery images={images} productName={name} isRTL={isRTL} />
        </div>

        {/* ─── RIGHT: Product Info (5 cols ≈ 42%) ─── */}
        <div className="lg:col-span-5 lg:sticky lg:top-20 lg:self-start pt-8 lg:pt-2 space-y-0">

          {/* Category */}
          {categoryName && (
            <p className={`uppercase text-[#0f1419]/30 mb-4 ${isRTL ? 'text-[13px]' : 'text-[11px] tracking-[0.15em]'}`}>{categoryName}</p>
          )}

          {/* Product Name — Cairo for Arabic, Playfair for Latin */}
          <h1 className={`leading-[1.25] text-[#0f1419] mb-6 ${
            isRTL
              ? 'font-arabic text-[28px] sm:text-[34px] font-semibold'
              : 'font-display font-light text-[26px] sm:text-[32px]'
          }`}>
            {name}
          </h1>

          {/* Price */}
          <div className="flex items-baseline gap-3 mb-2">
            <span className="text-xl font-medium tabular-nums text-[#0f1419]">
              &euro;{price.toFixed(2)}
            </span>
            {hasDiscount && (
              <>
                <span className="text-sm text-[#0f1419]/30 line-through tabular-nums">&euro;{basePrice.toFixed(2)}</span>
                <span className={`tracking-wide text-[#b45309] font-medium ${isRTL ? 'text-[13px]' : 'text-[12px]'}`}>-{discountPercent}%</span>
              </>
            )}
          </div>
          <p className={`text-[#0f1419]/30 mb-7 ${isRTL ? 'text-[13px]' : 'text-[12px]'}`}>
            {t('priceIncludesVat', { rate: Number(product.taxRate).toFixed(0) })}
          </p>

          {/* Stock Progress Bar (urgency) */}
          {showLowStock && (
            <div className="mb-7">
              <div className="flex items-center justify-between mb-2">
                <span className={`font-medium ${available <= 2 ? 'text-[#dc2626]' : 'text-[#b45309]'} ${isRTL ? 'text-[13px]' : 'text-[12px] tracking-wide'}`}>
                  {t('lowStock', { count: available })}
                </span>
              </div>
              <div className="h-[3px] bg-[#f5f5f5] rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(available / 5) * 100}%` }}
                  transition={{ duration: 0.8, ease: [0.25, 0.1, 0.25, 1] }}
                  className={`h-full rounded-full ${available <= 2 ? 'bg-[#dc2626]' : 'bg-[#d97706]'}`}
                />
              </div>
            </div>
          )}

          {/* Campaign Countdown (urgency - alternative) */}
          {showCampaign && countdown && (
            <div className={`flex items-center gap-2 mb-7 text-[#0f1419]/40 ${isRTL ? 'text-[13px]' : 'text-[12px] tracking-[0.1em]'}`}>
              <span>{t3('Angebot endet in', 'Offer ends in', 'ينتهي العرض في')}</span>
              <span className="font-mono tabular-nums text-[#b45309]">{countdown}</span>
            </div>
          )}

          {/* Delivery */}
          {available > 0 && (
            <div className={`flex items-center gap-2.5 mb-8 text-[#0f1419]/45 ${isRTL ? 'text-sm' : 'text-[13px]'}`}>
              <Truck className="h-4 w-4 flex-shrink-0" strokeWidth={1.5} />
              <span>{t('deliveryEstimate')} <span className="text-[#0f1419]/70 font-medium">{deliveryDate}</span></span>
            </div>
          )}

          {/* No-Return Notice */}
          {product.excludeFromReturns && (
            <div className={`flex items-start gap-2.5 py-3 px-4 mb-6 border border-[#d97706]/20 text-[#b45309]/80 leading-relaxed ${isRTL ? 'text-[13px]' : 'text-[12px]'}`}>
              <span className="mt-0.5 flex-shrink-0">&#9888;</span>
              <span>{t3('Dieser Artikel ist vom Umtausch ausgeschlossen', 'This item cannot be returned', 'لا يمكن إرجاع هذا المنتج')}</span>
            </div>
          )}

          {/* ═══ VARIANTS ═══ */}
          {variants.length > 1 && (
            <div className="border-t border-[#e5e5e5] pt-7 pb-1 space-y-6">

              {/* Color Selector */}
              {colors.length > 0 && (
                <div>
                  <label className={`text-[#0f1419]/40 mb-3 block ${isRTL ? 'text-sm' : 'text-[13px] tracking-[0.08em]'}`}>
                    {t('color')}{selectedColor ? ` — ${translateColor(selectedColor, locale)}` : ''}
                  </label>
                  <div className="flex flex-wrap gap-2.5">
                    {colors.map(({ color, hex }: any) => {
                      const avail = isColorAvailable(color)
                      const sel = selectedColor === color
                      return (
                        <button
                          key={color}
                          onClick={() => {
                            const v = findVariant(color, selectedSize) ?? findVariant(color)
                            if (v) handleVariantSelect(v.id)
                          }}
                          disabled={!avail}
                          title={translateColor(color, locale)}
                          className={`relative h-9 w-9 rounded-full transition-all duration-200 ${
                            sel ? 'ring-[1.5px] ring-[#0f1419] ring-offset-2' : 'ring-1 ring-[#e5e5e5] hover:ring-[#0f1419]/30'
                          } ${!avail ? 'opacity-25 cursor-not-allowed' : ''}`}
                        >
                          <span className="absolute inset-[3px] rounded-full" style={{ backgroundColor: hex ?? color?.toLowerCase() ?? '#ccc' }} />
                          {!avail && <span className="absolute inset-0 flex items-center justify-center"><span className="w-full h-px bg-[#0f1419]/40 rotate-45 absolute" /></span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Size Selector */}
              {sizes.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className={`text-[#0f1419]/40 ${isRTL ? 'text-sm' : 'text-[13px] tracking-[0.08em]'}`}>
                      {t('size')}{selectedSize ? ` — ${selectedSize}` : ''}
                    </label>
                    <button className={`underline underline-offset-4 decoration-[#0f1419]/15 text-[#0f1419]/40 hover:text-[#0f1419]/60 transition-colors ${isRTL ? 'text-[13px]' : 'text-[12px]'}`}>
                      {t('sizeGuide')}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {sizes.map((size) => {
                      const avail = isSizeAvailable(size)
                      const sel = selectedSize === size
                      return (
                        <button
                          key={size}
                          onClick={() => {
                            const v = findVariant(selectedColor, size) ?? findVariant(undefined, size)
                            if (v) handleVariantSelect(v.id)
                          }}
                          disabled={!avail}
                          className={`h-10 min-w-[2.75rem] px-3.5 text-[13px] tracking-wide transition-all duration-200 border ${
                            sel
                              ? 'border-[#0f1419] bg-[#0f1419] text-white'
                              : 'border-[#e5e5e5] text-[#0f1419]/60 hover:border-[#0f1419]/30'
                          } ${!avail ? 'opacity-20 cursor-not-allowed line-through' : ''}`}
                        >
                          {size}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══ ADD TO CART ═══ */}
          <div className="border-t border-[#e5e5e5] pt-7 space-y-4">

            {/* Quantity */}
            <div className="flex items-center gap-3">
              <span className={`text-[#0f1419]/40 ${isRTL ? 'text-sm' : 'text-[13px] tracking-[0.08em]'}`}>
                {t3('Menge', 'Qty', 'الكمية')}
              </span>
              <div className="flex items-center border border-[#e5e5e5]">
                <button
                  onClick={() => setQty(Math.max(1, qty - 1))}
                  disabled={qty <= 1}
                  className="h-9 w-9 flex items-center justify-center text-[#0f1419]/40 hover:text-[#0f1419] transition-colors disabled:opacity-20"
                  aria-label="Decrease"
                >
                  <Minus className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
                <span className="w-10 h-9 flex items-center justify-center text-[13px] tabular-nums text-[#0f1419] border-x border-[#e5e5e5]">
                  {qty}
                </span>
                <button
                  onClick={() => setQty(Math.min(maxQty, qty + 1))}
                  disabled={qty >= maxQty}
                  className="h-9 w-9 flex items-center justify-center text-[#0f1419]/40 hover:text-[#0f1419] transition-colors disabled:opacity-20"
                  aria-label="Increase"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </div>
            </div>

            {/* CTA Row: Add to Cart + Wishlist */}
            <div className="flex items-stretch gap-3">
              <motion.button
                whileTap={!cartDisabled && available > 0 ? { scale: 0.98 } : undefined}
                onClick={handleAddToCart}
                disabled={available <= 0 || cartDisabled}
                className={`flex-1 h-[52px] flex items-center justify-center gap-2.5 font-medium transition-all duration-300 ${
                  isRTL ? 'text-[15px]' : 'text-[13px] tracking-[0.1em] uppercase'
                } ${
                  added
                    ? 'bg-[#1a7a3a] text-white'
                    : available <= 0
                      ? 'bg-[#f5f5f5] text-[#0f1419]/25 cursor-not-allowed'
                      : 'bg-[#d4a853] text-white hover:bg-[#c49b45]'
                }`}
              >
                <AnimatePresence mode="wait">
                  {added ? (
                    <motion.span key="ok" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} className="flex items-center gap-2">
                      <Check className="h-4 w-4" strokeWidth={2} />{t('added')}
                    </motion.span>
                  ) : available <= 0 ? (
                    <span>{t('outOfStock')}</span>
                  ) : (
                    <motion.span key="add" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                      <ShoppingBag className="h-4 w-4" strokeWidth={1.5} />{t('addToCart')}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>

              {/* Wishlist */}
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={handleWishlist}
                className={`h-[52px] w-[52px] flex items-center justify-center border transition-all duration-200 flex-shrink-0 ${
                  wishlisted ? 'border-[#fecaca] bg-[#fef2f2]' : 'border-[#e5e5e5] hover:border-[#0f1419]/20'
                } ${wishPop ? 'scale-110' : ''}`}
                aria-label={t('addToWishlist')}
              >
                <Heart className={`h-[18px] w-[18px] transition-all duration-200 ${wishlisted ? 'fill-[#ef4444] text-[#ef4444]' : 'text-[#0f1419]/30'}`} strokeWidth={1.5} />
              </motion.button>
            </div>

            {/* Notify when back in stock */}
            {available <= 0 && selectedVariant && (
              <div className="pt-2">
                <NotifyWhenAvailable productId={product.id} variantId={selectedVariant.id} locale={locale} />
              </div>
            )}
          </div>

          {/* ═══ SHARE ═══ */}
          <div className="flex items-center gap-3 pt-6">
            <span className={`text-[#0f1419]/25 ${isRTL ? 'text-[13px]' : 'text-[11px] tracking-[0.08em] uppercase'}`}>{t('share')}</span>
            <a
              href={currentUrl ? getWhatsAppShareUrl(name, `€${price.toFixed(2)}`, currentUrl, locale) : '#'}
              target="_blank" rel="noopener noreferrer" aria-label="WhatsApp"
              className="h-9 w-9 flex items-center justify-center text-[#0f1419]/25 hover:text-[#25d366] transition-colors"
            >
              <MessageCircle className="h-4 w-4" strokeWidth={1.5} />
            </a>
            <button
              onClick={handleCopyLink}
              className="h-9 w-9 flex items-center justify-center text-[#0f1419]/25 hover:text-[#0f1419]/50 transition-colors"
              aria-label={t('copyLink')}
            >
              <Copy className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════════ TABS ═══════════════ */}
      <div className="mt-20 lg:mt-28 pt-0">
        <PremiumTabs tabs={tabs} defaultTab="description" isRTL={isRTL} />
      </div>

      {/* ═══════════════ TRUST BAR ═══════════════ */}
      <div className="border-t border-[#e5e5e5]">
        <PremiumTrustBar locale={locale} />
      </div>

      {/* ═══════════════ RELATED PRODUCTS ═══════════════ */}
      {similarProducts.length > 0 && (
        <section className="py-16 border-t border-[#e5e5e5]">
          <h2 className={`text-[#0f1419]/30 mb-10 ${isRTL ? 'text-base font-medium' : 'text-sm tracking-[0.12em] uppercase'}`}>
            {t3('Das könnte dir auch gefallen', 'You may also like', 'قد يعجبك أيضاً')}
          </h2>
          <div className="flex gap-5 overflow-x-auto scrollbar-hide pb-2 -mx-4 px-4 lg:mx-0 lg:px-0">
            {similarProducts.map((sp: any) => {
              const spName = sp.name ?? sp.translations?.[0]?.name ?? sp.slug
              const spImage = sp.images?.find((i: any) => i.isPrimary)?.url ?? sp.images?.[0]?.url ?? sp.imageUrl
              const spPrice = sp.salePrice ?? sp.basePrice
              return (
                <Link key={sp.id} href={`/${locale}/products/${sp.slug}`} className="flex-shrink-0 w-[180px] sm:w-[210px] group">
                  <div className="aspect-[3/4] bg-[#f5f5f5] overflow-hidden mb-3">
                    {spImage && (
                      <img
                        src={spImage} alt={spName}
                        className="w-full h-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1)] group-hover:scale-[1.03]"
                        loading="lazy"
                      />
                    )}
                  </div>
                  <p className="text-[13px] font-light text-[#0f1419] truncate leading-snug">{spName}</p>
                  <p className="text-[13px] text-[#0f1419]/40 mt-1 tabular-nums">&euro;{Number(spPrice).toFixed(2)}</p>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* ═══════════════ RECENTLY VIEWED ═══════════════ */}
      <PremiumRecentlyViewed currentProductId={product.id} locale={locale} />

      {/* ═══════════════ REVIEWS PLACEHOLDER ═══════════════ */}
      <section className="py-16 border-t border-[#e5e5e5]">
        <h2 className={`text-[#0f1419]/30 mb-8 ${isRTL ? 'text-base font-medium' : 'text-sm tracking-[0.12em] uppercase'}`}>
          {t('reviews')}
        </h2>
        <div className="flex items-center gap-1 mb-4">
          {[1, 2, 3, 4, 5].map(i => (
            <Star key={i} className="h-4 w-4 text-[#e5e5e5]" strokeWidth={1.5} />
          ))}
        </div>
        <p className="text-[13px] font-light text-[#0f1419]/30 italic">
          {t('noReviews')}
        </p>
      </section>

      {/* ═══════════════ MOBILE STICKY BAR ═══════════════ */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-sm border-t border-[#e5e5e5] px-4 py-3 lg:hidden safe-bottom">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className={`text-[#0f1419] truncate ${isRTL ? 'text-sm' : 'text-[13px] font-light'}`}>{name}</p>
            <p className="text-[13px] tabular-nums text-[#0f1419]/60">&euro;{price.toFixed(2)}</p>
          </div>
          <button
            onClick={handleStickyAdd}
            disabled={available <= 0}
            className={`flex-shrink-0 h-11 px-6 bg-[#d4a853] text-white font-medium hover:bg-[#c49b45] transition-colors disabled:bg-[#f5f5f5] disabled:text-[#0f1419]/25 flex items-center gap-2 ${isRTL ? 'text-[13px]' : 'text-[12px] tracking-[0.1em] uppercase'}`}
          >
            <ShoppingBag className="h-3.5 w-3.5" strokeWidth={1.5} />
            {available <= 0 ? t('outOfStock') : t('addToCart')}
          </button>
        </div>
      </div>

      {/* Bottom padding for mobile sticky bar */}
      <div className="h-20 lg:hidden" />
    </div>
  )
}
