'use client'

import { useMemo, useCallback, useEffect, useState, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Truck, Heart, MessageCircle, Minus, Plus,
  ShoppingBag, Check, Copy, ShieldCheck,
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
import { compareSizes } from '@/lib/sizes'
import { PremiumTabs } from '@/components/product/premium/premium-tabs'
import { PremiumTrustBar } from '@/components/product/premium/premium-trust-bar'
import { PremiumRecentlyViewed, saveRecentlyViewed } from '@/components/product/premium/premium-recently-viewed'
import { ProductCard } from '@/components/product/product-card'
import { SizeGuideModal } from '@/components/product/size-guide-modal'
import { ProductReviews } from '@/components/product/product-reviews'

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
  const cartItems = useCartStore((s) => s.items)
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

  // ── Color override: when a user clicks a NEW color, we keep them on that color
  //    but force them to RE-PICK a size (Zalando-style). Cleared once they pick.
  const [colorOverride, setColorOverride] = useState<string | null>(null)

  // Reset the override whenever the URL points to a different variant — keeps the
  // store-link semantics intact (e.g. shared link with ?variant=…).
  useEffect(() => { setColorOverride(null) }, [selectedVariantId])

  // Effective color = override (if user is actively switching) or the currently selected variant's color.
  // Effective size  = empty when an override is active, so the dropdown shows "Bitte Größe wählen".
  const effectiveColor: string | undefined = colorOverride ?? selectedVariant?.color
  const effectiveSize: string | undefined = colorOverride ? undefined : selectedVariant?.size

  // ── Dynamic pricing ──
  const modifier = Number(selectedVariant?.priceModifier ?? 0)
  const basePrice = Math.max(0, serverBase + modifier)
  const price = computed.hasDiscount ? Math.max(0, computed.price + modifier) : basePrice
  const hasDiscount = computed.hasDiscount && price < basePrice
  const discountPercent = hasDiscount && basePrice > 0 ? Math.round((1 - price / basePrice) * 100) : 0

  // ── Stock ──
  // When an override is active the user has not yet picked a size, so available stock is 0
  // (which disables the cart button and forces them to choose).
  const available = colorOverride ? 0 : getStock(selectedVariant)
  const selectedColor = effectiveColor

  // ── Images: ALWAYS show all photos, but reorder so the selected color comes first.
  //          When the color changes, PremiumGallery is remounted via `key={selectedColor}`
  //          which jumps the user to the first matching image automatically.
  const allImages = product.images ?? []
  const displayImages = (() => {
    if (!selectedColor) return allImages
    const matching = allImages.filter((img: any) => img.colorName === selectedColor)
    if (matching.length === 0) return allImages
    const others = allImages.filter((img: any) => img.colorName !== selectedColor)
    return [...matching, ...others]
  })()
  const images = displayImages.map((img: any) => ({ url: img.url, altText: img.altText ?? undefined }))

  // ── Variant extraction ──
  const variants = product.variants ?? []
  const colorMap = new Map<string, { color: string; hex: string }>()
  for (const v of variants.filter((v: any) => v.color)) {
    if (!colorMap.has(v.color)) colorMap.set(v.color, { color: v.color, hex: v.colorHex ?? '' })
  }
  const colors = [...colorMap.values()]
  const sizes: string[] = [
    ...new Set<string>(variants.filter((v: any) => v.size).map((v: any) => v.size! as string)),
  ].sort(compareSizes)

  const findVariant = (color?: string, size?: string) =>
    variants.find((v: any) => (color ? v.color === color : true) && (size ? v.size === size : true) && v.isActive)

  // Same as findVariant but only returns variants that actually have stock.
  // Used by click handlers so we never auto-select an out-of-stock variant when
  // an in-stock one exists for the same color or size.
  const findStockedVariant = (color?: string, size?: string) =>
    variants.find(
      (v: any) =>
        (color ? v.color === color : true) &&
        (size ? v.size === size : true) &&
        v.isActive &&
        getStock(v) > 0,
    )

  // Color is available if ANY active variant of that color has stock.
  const isColorAvailable = (color: string) =>
    variants.some((v: any) => v.color === color && v.isActive && getStock(v) > 0)

  // Sizes shown in the dropdown — only those that exist (with stock) for the current color.
  // If no color is selected (single-color products / fallback), show every available size.
  const availableSizesForCurrentColor: string[] = (() => {
    const filtered = variants.filter((v: any) => {
      if (!v.isActive || getStock(v) <= 0 || !v.size) return false
      return selectedColor ? v.color === selectedColor : true
    })
    return [...new Set<string>(filtered.map((v: any) => v.size as string))].sort(compareSizes)
  })()

  const handleVariantSelect = useCallback((variantId: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('variant', variantId)
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [searchParams, router])

  // ── Cart ──
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)
  const [cartDisabled, setCartDisabled] = useState(false)
  // Account for items already in the cart to prevent adding more than available
  const alreadyInCart = cartItems.find((i) => i.variantId === selectedVariant?.id)?.quantity ?? 0
  const maxQty = Math.max(0, Math.min(available - alreadyInCart, 10))

  useEffect(() => { setQty(1); setAdded(false) }, [selectedVariant?.id])
  useEffect(() => { if (qty > maxQty && maxQty > 0) setQty(maxQty) }, [maxQty, qty])

  const handleAddToCart = useCallback(() => {
    if (cartDisabled || available <= 0 || !selectedVariant) return
    // Prevent adding more than available stock (accounting for cart quantity)
    const effectiveQty = Math.min(qty, available - alreadyInCart)
    if (effectiveQty <= 0) {
      toast.info(t3(
        `Du hast den letzten verfügbaren Artikel bereits im Warenkorb.`,
        `You already have the last available item in your cart.`,
        `لديك آخر قطعة متوفرة في سلة التسوق بالفعل.`,
      ))
      openDrawer()
      return
    }
    setCartDisabled(true)
    addCartItem({
      variantId: selectedVariant.id, productId: product.id, slug: product.slug, name, sku: selectedVariant.sku,
      color: selectedVariant.color, size: selectedVariant.size, imageUrl: images[0]?.url,
      unitPrice: price, quantity: effectiveQty,
    })
    const ev = { content_name: name, content_ids: [product.id], content_type: 'product', value: price * qty, currency: 'EUR' }
    trackMetaEvent('AddToCart', ev); trackTikTokEvent('AddToCart', ev)
    setAdded(true)
    openDrawer()
    setTimeout(() => { setAdded(false); setCartDisabled(false) }, 2500)
  }, [cartDisabled, available, alreadyInCart, selectedVariant, addCartItem, product, name, images, price, qty, openDrawer])

  // ── Wishlist ──
  const wishlisted = isInWishlist(product.id)
  const [wishPop, setWishPop] = useState(false)
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false)
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
            <div className="space-y-3">
              <p>{t3('Klicke auf "Größenberatung" bei der Größenauswahl für eine detaillierte Größentabelle und persönliche Empfehlung.', 'Click "Size Guide" at the size selection for a detailed size chart and personal recommendation.', 'اضغط على "دليل المقاسات" عند اختيار المقاس للحصول على جدول مقاسات مفصل وتوصية شخصية.')}</p>
              <button onClick={() => setSizeGuideOpen(true)} className="text-[#d4a853] underline underline-offset-4 hover:text-[#c49b45] transition-colors">
                {t('sizeGuide')}
              </button>
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'shipping',
      // Label intentionally "Shipping" only — the full return policy lives
      // in the footer (Widerrufsbelehrung / Widerruf legal page), customers
      // don't need a second copy on every PDP tab.
      label: t3('Versand', 'Shipping', 'الشحن'),
      content: (
        <div className="text-sm font-light leading-relaxed text-[#0f1419]/60 max-w-2xl space-y-3">
          <p>{t('shippingInfo')}</p>
          <p>{t('freeShippingInfo')}</p>
          {product.excludeFromReturns && (
            <p className="text-[#b45309] mt-4">
              {product.returnExclusionReason === 'hygiene'
                ? t3('Aus Hygienegründen kann dieser Artikel nach dem Öffnen nicht zurückgegeben werden.', 'For hygiene reasons, this product cannot be returned once opened.', 'لأسباب صحية، لا يمكن إرجاع هذا المنتج بعد فتحه.')
                : product.returnExclusionReason === 'custom_made'
                  ? t3('Maßanfertigungen sind vom Umtausch ausgeschlossen.', 'Custom-made items are non-returnable.', 'المنتجات المصنوعة حسب الطلب غير قابلة للإرجاع.')
                  : t3('Versiegelte Ware kann nach dem Öffnen nicht zurückgegeben werden.', 'Sealed items cannot be returned once opened.', 'المنتجات المختومة غير قابلة للإرجاع بعد فتحها.')}
            </p>
          )}
        </div>
      ),
    },
  ]

  // ── Sticky add-to-cart (mobile) ──
  // ── Sticky bar: show only when PHOTO visible AND CTA not visible ──
  const galleryRef = useRef<HTMLDivElement>(null)
  const ctaRef = useRef<HTMLDivElement>(null)
  const [photoVisible, setPhotoVisible] = useState(false)
  const [ctaVisible, setCtaVisible] = useState(true)
  const showStickyBar = photoVisible && !ctaVisible

  useEffect(() => {
    if (!galleryRef.current) return
    const obs = new IntersectionObserver(([e]) => setPhotoVisible(e.isIntersecting), { threshold: 0.1 })
    obs.observe(galleryRef.current)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!ctaRef.current) return
    const obs = new IntersectionObserver(([e]) => setCtaVisible(e.isIntersecting), { threshold: 0 })
    obs.observe(ctaRef.current)
    return () => obs.disconnect()
  }, [])

  const handleStickyAdd = () => {
    if (!selectedVariant || available <= 0) return
    addCartItem({
      variantId: selectedVariant.id, productId: product.id, slug: product.slug, name, sku: selectedVariant.sku,
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
      <div className="grid grid-cols-1 lg:grid-cols-[55fr_45fr] lg:gap-12 xl:gap-16">

        {/* ─── LEFT: Gallery (55%) — shorter on mobile (4:5) for faster scroll to info ─── */}
        <div ref={galleryRef} className="order-1 -mx-4 sm:-mx-6 lg:mx-0 lg:max-h-none">
          {/* key forces remount on color change so the gallery jumps to the first
              image of the newly-selected color (which we put first in `images` above) */}
          <PremiumGallery key={selectedColor ?? 'all'} images={images} productName={name} isRTL={isRTL} />
        </div>

        {/* ─── RIGHT: Product Info (45%) — comes after the gallery on mobile ─── */}
        <div className="order-2 lg:sticky lg:top-16 lg:self-start pt-6 lg:pt-0">

          {/* Category */}
          {categoryName && (
            <p className={`uppercase text-[#0f1419]/50 mb-5 ${isRTL ? 'text-sm' : 'text-xs tracking-[0.15em]'}`}>{categoryName}</p>
          )}

          {/* Product Name */}
          <h1 className={`leading-[1.25] text-[#0f1419] mb-8 ${
            isRTL
              ? 'font-arabic text-[28px] sm:text-[34px] font-semibold'
              : 'font-display font-light text-[26px] sm:text-[32px]'
          }`}>
            {name}
          </h1>

          {/* Price */}
          <div className="flex items-baseline gap-3 mb-2">
            <span className="text-2xl lg:text-xl font-semibold lg:font-medium tabular-nums text-[#0f1419]">
              &euro;{price.toFixed(2)}
            </span>
            {hasDiscount && (
              <>
                <span className="text-sm text-[#0f1419]/35 line-through tabular-nums">&euro;{basePrice.toFixed(2)}</span>
                <span className={`tracking-wide text-[#b45309] font-semibold ${isRTL ? 'text-sm' : 'text-[13px]'}`}>-{discountPercent}%</span>
              </>
            )}
          </div>
          <p className={`text-[#0f1419]/50 mt-1 ${isRTL ? 'text-sm' : 'text-xs'}`}>
            {t('priceIncludesVat', { rate: Number(product.taxRate).toFixed(0) })}
          </p>

          {/* Mobile-only mini trust signals — directly under price for fast visibility */}
          <div className="flex items-center gap-4 mt-4 mb-4 lg:hidden text-xs text-[#0f1419]/45">
            <span className="flex items-center gap-1"><Truck className="h-3.5 w-3.5 text-[#d4a853]" />{t3('Ab €100 gratis', 'Free from €100', 'شحن مجاني من 100€')}</span>
            <span className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-[#d4a853]" />{t3('Sicher bezahlen', 'Secure payment', 'دفع آمن')}</span>
          </div>

          {/* Stock indicator — hidden during color-override (user is mid-pick) so we
              don't show a misleading "Out of stock" while they haven't chosen a size yet. */}
          {!colorOverride && (
            <div className="mt-5 mb-10">
              {available > 5 && (
                <span className={`text-[#16a34a] ${isRTL ? 'text-sm' : 'text-xs tracking-wide'}`}>
                  {t('inStock')}
                </span>
              )}
              {showLowStock && (
                <div>
                  <span className={`font-medium ${available <= 2 ? 'text-[#dc2626]' : 'text-[#b45309]'} ${isRTL ? 'text-sm' : 'text-xs tracking-wide'}`}>
                    {t('lowStock', { count: available })}
                  </span>
                  <div className="h-[3px] bg-[#f5f5f5] rounded-full overflow-hidden mt-2">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(available / 5) * 100}%` }}
                      transition={{ duration: 0.8, ease: [0.25, 0.1, 0.25, 1] }}
                      className={`h-full rounded-full ${available <= 2 ? 'bg-[#dc2626]' : 'bg-[#d97706]'}`}
                    />
                  </div>
                </div>
              )}
              {available <= 0 && (
                <span className={`text-[#dc2626] ${isRTL ? 'text-sm' : 'text-xs tracking-wide'}`}>
                  {t('outOfStock')}
                </span>
              )}
            </div>
          )}

          {/* Campaign Countdown (urgency - alternative) */}
          {showCampaign && countdown && (
            <div className={`flex items-center gap-2 mb-10 text-[#0f1419]/60 ${isRTL ? 'text-sm' : 'text-xs tracking-[0.1em]'}`}>
              <span>{t3('Angebot endet in', 'Offer ends in', 'ينتهي العرض في')}</span>
              <span className="font-mono tabular-nums text-[#b45309]">{countdown}</span>
            </div>
          )}

          {/* Delivery */}
          {available > 0 && (
            <div className={`flex items-center gap-2.5 mb-10 text-[#0f1419]/60 ${isRTL ? 'text-sm' : 'text-[13px]'}`}>
              <Truck className="h-4 w-4 flex-shrink-0" strokeWidth={1.5} />
              <span>{t('deliveryEstimate')} <span className="text-[#0f1419]/70 font-medium">{deliveryDate}</span></span>
            </div>
          )}

          {/* No-Return Notice */}
          {product.excludeFromReturns && (
            <div className={`flex items-start gap-2.5 py-3 px-4 mb-8 border border-[#d97706]/20 text-[#b45309]/80 leading-relaxed ${isRTL ? 'text-sm' : 'text-xs'}`}>
              <span className="mt-0.5 flex-shrink-0">&#9888;</span>
              <span>{t3('Dieser Artikel ist vom Umtausch ausgeschlossen', 'This item cannot be returned', 'لا يمكن إرجاع هذا المنتج')}</span>
            </div>
          )}

          {/* ═══ VARIANTS ═══ */}
          {variants.length > 1 && (
            <div className="border-t border-[#e5e5e5] pt-6 lg:pt-8 pb-2 space-y-6 lg:space-y-8">

              {/* Color Selector — premium round circles */}
              {colors.length > 0 && (
                <div>
                  <label className={`text-[#0f1419]/60 mb-4 block ${isRTL ? 'text-[15px]' : 'text-sm tracking-[0.08em]'}`}>
                    {t('color')}{selectedColor ? ` — ${translateColor(selectedColor, locale)}` : ''}
                  </label>
                  <div className="flex flex-wrap gap-2 lg:gap-3">
                    {colors.map(({ color, hex }: any) => {
                      const avail = isColorAvailable(color)
                      const sel = selectedColor === color
                      return (
                        <button
                          key={color}
                          onClick={() => {
                            if (!avail) return
                            if (color === effectiveColor) return
                            setColorOverride(color)
                          }}
                          disabled={!avail}
                          title={avail ? translateColor(color, locale) : `${translateColor(color, locale)} — ${t('outOfStock')}`}
                          className={`relative h-10 w-10 lg:h-10 lg:w-10 rounded-full transition-all duration-200 ${
                            sel
                              ? 'ring-2 ring-[#d4a853] ring-offset-[3px]'
                              : avail
                                ? 'ring-1 ring-[#d0d0d0] hover:ring-[#0f1419]/40'
                                : 'opacity-40 cursor-not-allowed ring-1 ring-[#e0e0e0]'
                          }`}
                        >
                          <span className="absolute inset-[3px] rounded-full" style={{ backgroundColor: hex ?? color?.toLowerCase() ?? '#ccc' }} />
                          {!avail && (
                            <span className="absolute inset-0 flex items-center justify-center">
                              <span className="w-[130%] h-[1.5px] bg-[#0f1419]/50 rotate-45 absolute rounded-full" />
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Size Selector — Zalando-style dropdown */}
              {sizes.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className={`text-[#0f1419]/60 ${isRTL ? 'text-[15px]' : 'text-sm tracking-[0.08em]'}`}>
                      {t('size')}
                      {effectiveSize && availableSizesForCurrentColor.length > 0 && (
                        <span className="ms-2 text-[#0f1419] font-medium">— {effectiveSize}</span>
                      )}
                    </label>
                    <button onClick={() => setSizeGuideOpen(true)} className={`underline underline-offset-4 decoration-[#0f1419]/20 text-[#0f1419]/50 hover:text-[#0f1419]/70 transition-colors ${isRTL ? 'text-sm' : 'text-xs'}`}>
                      {t('sizeGuide')}
                    </button>
                  </div>

                  {/* Size pill grid — each size is a large tappable button.
                      Replaces the native <select> because iOS/Android render
                      it with tiny system fonts that are near-illegible on a
                      dark-backgrounded page. Keeps id="size-select" on the
                      container so the add-to-cart scroll-to-size still lands
                      on the right element. */}
                  {availableSizesForCurrentColor.length > 0 ? (
                    <div id="size-select" className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                      {availableSizesForCurrentColor.map((size) => {
                        const isSelected = effectiveSize === size
                        const inStock = !!findStockedVariant(effectiveColor, size)
                        return (
                          <button
                            key={size}
                            type="button"
                            disabled={!inStock}
                            onClick={() => {
                              const v =
                                findStockedVariant(effectiveColor, size) ??
                                findStockedVariant(undefined, size) ??
                                findVariant(effectiveColor, size) ??
                                findVariant(undefined, size)
                              if (v) {
                                setColorOverride(null)
                                handleVariantSelect(v.id)
                              }
                            }}
                            aria-pressed={isSelected}
                            aria-label={`${t('size')} ${size}${inStock ? '' : ' — ' + (locale === 'ar' ? 'غير متوفر' : locale === 'en' ? 'out of stock' : 'nicht verfügbar')}`}
                            className={`relative h-11 lg:h-12 min-w-[2.75rem] lg:min-w-[3rem] px-2.5 lg:px-3 text-sm lg:text-[15px] font-medium transition-all select-none ${
                              isSelected
                                ? 'bg-[#0f1419] text-white ring-2 ring-[#d4a853] ring-offset-2 ring-offset-white'
                                : inStock
                                ? 'bg-white text-[#0f1419] border border-[#0f1419]/20 hover:border-[#0f1419] hover:bg-[#0f1419]/[0.02]'
                                : 'bg-[#0f1419]/[0.02] text-[#0f1419]/30 border border-dashed border-[#0f1419]/15 cursor-not-allowed line-through'
                            }`}
                          >
                            {size}
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-[#c43d3d]">
                      {locale === 'ar'
                        ? 'لا توجد مقاسات متوفرة لهذا اللون'
                        : locale === 'en'
                        ? 'No sizes available in this color'
                        : 'Keine Größen in dieser Farbe verfügbar'}
                    </p>
                  )}

                  {!effectiveSize && availableSizesForCurrentColor.length > 0 && (
                    <p className="mt-3 text-xs text-[#0f1419]/50">
                      {locale === 'ar'
                        ? 'اختر مقاسًا'
                        : locale === 'en'
                        ? 'Please select a size'
                        : 'Bitte Größe wählen'}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ═══ ADD TO CART ═══ */}
          <div className="border-t border-[#e5e5e5] pt-8 space-y-5">

            {/* Quantity */}
            <div className="flex items-center gap-3">
              <span className={`text-[#0f1419]/60 ${isRTL ? 'text-[15px]' : 'text-sm tracking-[0.08em]'}`}>
                {t3('Menge', 'Qty', 'الكمية')}
              </span>
              <div className="inline-flex items-center border border-[#e5e5e5]" dir="ltr">
                <button
                  onClick={() => setQty(Math.max(1, qty - 1))}
                  disabled={qty <= 1}
                  className="h-10 w-10 flex items-center justify-center text-[#0f1419]/50 hover:text-[#0f1419] transition-colors disabled:opacity-20"
                  aria-label="Decrease"
                >
                  <Minus className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
                <span
                  className="font-sans text-[14px] tabular-nums text-[#0f1419] border-x border-[#e5e5e5] select-none"
                  style={{ width: 48, height: 40, lineHeight: '40px', textAlign: 'center', display: 'block' }}
                  dir="ltr"
                >
                  {qty}
                </span>
                <button
                  onClick={() => setQty(Math.min(maxQty, qty + 1))}
                  disabled={qty >= maxQty}
                  className="h-10 w-10 flex items-center justify-center text-[#0f1419]/50 hover:text-[#0f1419] transition-colors disabled:opacity-20"
                  aria-label="Increase"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </div>
            </div>

            {/* CTA Row: Add to Cart + Wishlist — ref for sticky bar visibility */}
            <div ref={ctaRef} className="flex items-stretch gap-3">
              {(() => {
                // Three CTA states:
                //   needsSize → user picked a color but no size yet → "Bitte Größe wählen"
                //   outOfStock → variant is real but stock <= 0 → "Ausverkauft"
                //   ok → in stock → "In den Warenkorb"
                const needsSize = !!effectiveColor && !effectiveSize
                const outOfStock = !needsSize && available <= 0
                const allInCart = !needsSize && !outOfStock && maxQty <= 0
                const buttonLabel = needsSize
                  ? (locale === 'ar' ? 'اختر مقاسًا' : locale === 'en' ? 'Please select a size' : 'Bitte Größe wählen')
                  : allInCart
                    ? (locale === 'ar' ? 'بالفعل في السلة' : locale === 'en' ? 'Already in cart' : 'Bereits im Warenkorb')
                    : t('outOfStock')
                return (
                  <motion.button
                    whileTap={!cartDisabled && available > 0 ? { scale: 0.98 } : undefined}
                    onClick={handleAddToCart}
                    disabled={available <= 0 || cartDisabled || needsSize}
                    className={`flex-1 h-14 flex items-center justify-center gap-2.5 font-semibold transition-all duration-300 ${
                      isRTL ? 'text-[15px]' : 'text-[14px] tracking-[0.1em] uppercase'
                    } ${
                      added
                        ? 'bg-[#1a7a3a] text-white'
                        : needsSize
                          ? 'bg-[#1a1a2e]/90 text-white cursor-pointer hover:bg-[#1a1a2e]'
                          : outOfStock
                            ? 'bg-[#f5f5f5] text-[#0f1419]/25 cursor-not-allowed'
                            : 'bg-[#0f1419] text-white hover:bg-[#1a1a2e]'
                    }`}
                    onClickCapture={(e) => {
                      // If they need to pick a size, scroll the pill grid into view.
                      if (needsSize) {
                        e.preventDefault()
                        const el = document.getElementById('size-select')
                        if (el) {
                          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                          // Focus the first enabled size button so keyboard users
                          // land right on the grid.
                          const firstBtn = el.querySelector<HTMLButtonElement>('button:not([disabled])')
                          firstBtn?.focus()
                        }
                      }
                    }}
                  >
                    <AnimatePresence mode="wait">
                      {added ? (
                        <motion.span key="ok" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} className="flex items-center gap-2">
                          <Check className="h-5 w-5" strokeWidth={2} />{t('added')}
                        </motion.span>
                      ) : needsSize || outOfStock || allInCart ? (
                        <span>{buttonLabel}</span>
                      ) : (
                        <motion.span key="add" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2.5">
                          <ShoppingBag className="h-5 w-5" strokeWidth={1.5} />{t('addToCart')}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.button>
                )
              })()}

              {/* Wishlist */}
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={handleWishlist}
                className={`h-14 w-14 flex items-center justify-center border transition-all duration-200 flex-shrink-0 ${
                  wishlisted ? 'border-[#fecaca] bg-[#fef2f2]' : 'border-[#e5e5e5] hover:border-[#0f1419]/20'
                } ${wishPop ? 'scale-110' : ''}`}
                aria-label={t('addToWishlist')}
              >
                <Heart className={`h-5 w-5 transition-all duration-200 ${wishlisted ? 'fill-[#ef4444] text-[#ef4444]' : 'text-[#0f1419]/30'}`} strokeWidth={1.5} />
              </motion.button>
            </div>

            {/* Notify when back in stock — only when the user has actually landed on a
                concrete out-of-stock variant, NOT during a "pick-a-size" intermediate state. */}
            {!colorOverride && available <= 0 && selectedVariant && (
              <div className="pt-2">
                <NotifyWhenAvailable productId={product.id} variantId={selectedVariant.id} locale={locale} />
              </div>
            )}
          </div>

          {/* ═══ SHARE ═══ */}
          <div className="flex items-center gap-3 pt-6">
            <span className={`text-[#0f1419]/50 ${isRTL ? 'text-sm' : 'text-xs tracking-[0.08em] uppercase'}`}>{t('share')}</span>
            <a
              href={currentUrl ? getWhatsAppShareUrl(name, `€${price.toFixed(2)}`, currentUrl, locale) : '#'}
              target="_blank" rel="noopener noreferrer" aria-label="WhatsApp"
              className="h-9 w-9 flex items-center justify-center text-[#0f1419]/40 hover:text-[#25d366] transition-colors"
            >
              <MessageCircle className="h-4 w-4" strokeWidth={1.5} />
            </a>
            <button
              onClick={handleCopyLink}
              className="h-9 w-9 flex items-center justify-center text-[#0f1419]/40 hover:text-[#0f1419]/60 transition-colors"
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
        <section className="py-12 lg:py-16 border-t border-[#e5e5e5]">
          <h2 className={`text-[#0f1419]/50 mb-8 lg:mb-10 ${isRTL ? 'text-lg font-semibold' : 'text-sm lg:text-base tracking-[0.08em] uppercase'}`}>
            {t3('Das könnte dir auch gefallen', 'You may also like', 'قد يعجبك أيضاً')}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
            {similarProducts.slice(0, 4).map((sp: any) => (
              <ProductCard key={sp.id} product={sp} />
            ))}
          </div>
        </section>
      )}

      {/* ═══════════════ RECENTLY VIEWED ═══════════════ */}
      <PremiumRecentlyViewed currentProductId={product.id} locale={locale} />

      {/* ═══════════════ REVIEWS ═══════════════ */}
      <ProductReviews productId={product.id} />

      {/* ═══════════════ MOBILE STICKY BAR ═══════════════ */}
      <div className={`fixed bottom-16 left-0 right-0 z-50 bg-white/95 backdrop-blur-sm border-t border-[#e5e5e5] px-4 py-2 lg:hidden transition-transform duration-300 ${showStickyBar ? 'translate-y-0' : 'translate-y-[calc(100%+4rem)]'}`}>
        {/* Row 1: Color swatches + Size pills (compact) */}
        {colors.length > 0 || availableSizesForCurrentColor.length > 0 ? (
          <div className="flex items-center gap-3 mb-2">
            {/* Mini color swatches */}
            {colors.length > 0 && (
              <div className="flex items-center gap-1.5">
                {colors.map((c) => (
                  <button
                    key={c.color}
                    onClick={() => {
                      const v = findStockedVariant(c.color) || findVariant(c.color)
                      if (v) handleVariantSelect(v.id)
                    }}
                    className={`h-6 w-6 rounded-full border-2 transition-all ${
                      selectedColor === c.color ? 'border-[#d4a853] scale-110' : 'border-[#e5e5e5]'
                    }`}
                    style={{ backgroundColor: c.hex || '#ccc' }}
                    title={translateColor(c.color, locale)}
                  />
                ))}
              </div>
            )}
            {colors.length > 0 && availableSizesForCurrentColor.length > 0 && (
              <div className="w-px h-5 bg-[#e5e5e5]" />
            )}
            {/* Mini size pills */}
            {availableSizesForCurrentColor.length > 0 && (
              <div className="flex items-center gap-1 overflow-x-auto flex-1">
                {availableSizesForCurrentColor.map((size) => {
                  const isSelected = effectiveSize === size
                  return (
                    <button
                      key={size}
                      onClick={() => {
                        const v = findStockedVariant(selectedColor, size) || findVariant(selectedColor, size)
                        if (v) handleVariantSelect(v.id)
                      }}
                      className={`h-7 min-w-[2rem] px-2 rounded text-[11px] font-semibold transition-all flex-shrink-0 ${
                        isSelected
                          ? 'bg-[#0f1419] text-white'
                          : 'bg-[#f5f5f5] text-[#0f1419]/70 hover:bg-[#e5e5e5]'
                      }`}
                    >
                      {size}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ) : null}
        {/* Row 2: Price + Add to Cart */}
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-semibold tabular-nums text-[#0f1419]">&euro;{price.toFixed(2)}</p>
          </div>
          <button
            onClick={handleStickyAdd}
            disabled={available <= 0}
            className={`flex-shrink-0 h-11 px-6 rounded-lg bg-[#0f1419] text-white font-medium hover:bg-[#1a1a2e] transition-colors disabled:bg-[#f5f5f5] disabled:text-[#0f1419]/25 flex items-center gap-2 ${isRTL ? 'text-[13px]' : 'text-[12px] tracking-[0.1em] uppercase'}`}
          >
            <ShoppingBag className="h-3.5 w-3.5" strokeWidth={1.5} />
            {available <= 0 ? t('outOfStock') : t('addToCart')}
          </button>
        </div>
      </div>

      {/* Bottom padding for mobile sticky bar */}
      <div className="h-20 lg:hidden" />

      {/* Size Guide Modal */}
      <SizeGuideModal productId={product.id} isOpen={sizeGuideOpen} onClose={() => setSizeGuideOpen(false)} />
    </div>
  )
}
