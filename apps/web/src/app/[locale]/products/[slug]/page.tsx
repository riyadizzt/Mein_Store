import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { ProductClient } from './product-client'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

// Server-side data fetching — no client JS needed
async function getProduct(slug: string, lang: string) {
  const res = await fetch(`${API_URL}/api/v1/products/${slug}?lang=${lang}`, {
    next: { revalidate: 60 }, // ISR: revalidate every 60s
  })
  if (!res.ok) return null
  return res.json()
}

async function getSimilarProducts(lang: string) {
  const res = await fetch(`${API_URL}/api/v1/products?lang=${lang}&limit=8&sort=newest`, {
    next: { revalidate: 300 },
  })
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data) ? data : data?.items ?? data?.data ?? []
}

// Metadata for SEO
export async function generateMetadata({ params: { slug, locale } }: { params: { slug: string; locale: string } }) {
  const product = await getProduct(slug, locale)
  if (!product) return { title: 'Not Found' }

  const name = product.name ?? product.translations?.[0]?.name ?? slug
  const description = product.description ?? product.translations?.[0]?.description ?? ''
  const image = product.images?.find((i: any) => i.isPrimary)?.url ?? product.images?.[0]?.url

  return {
    title: name,
    description: description?.slice(0, 160),
    openGraph: {
      title: name,
      description: description?.slice(0, 160),
      images: image ? [{ url: image }] : [],
    },
  }
}

export default async function ProductDetailPage({
  params: { slug, locale },
}: {
  params: { slug: string; locale: string }
}) {
  const [product, similar, t, tHome] = await Promise.all([
    getProduct(slug, locale),
    getSimilarProducts(locale),
    getTranslations('product'),
    getTranslations('home'),
  ])

  if (!product) notFound()

  // Extract data server-side — zero client JS for this
  const p = product as any
  const name = p.name ?? product.translations?.[0]?.name ?? product.slug
  const description = p.description ?? product.translations?.[0]?.description ?? ''
  const categoryName = product.category?.translations?.[0]?.name ?? (product.category as any)?.name
  const price = product.salePrice ?? product.basePrice
  const hasDiscount = product.salePrice && Number(product.salePrice) < Number(product.basePrice)
  const discountPercent = hasDiscount ? Math.round((1 - Number(product.salePrice) / Number(product.basePrice)) * 100) : 0
  const primaryImage = product.images?.find((i: any) => i.isPrimary)?.url ?? product.images?.[0]?.url

  // Delivery estimate
  const deliveryDate = (() => {
    const d = new Date()
    let days = 3
    while (days > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) days-- }
    return d.toLocaleDateString(locale === 'de' ? 'de-DE' : locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'long' })
  })()

  // Filter similar products
  const filteredSimilar = (similar ?? []).filter((sp: any) => sp.id !== product.id).slice(0, 8)

  return (
    <>
      {/* JSON-LD (SEO) */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        '@context': 'https://schema.org', '@type': 'Product', name,
        image: primaryImage, description: description?.slice(0, 160),
        offers: { '@type': 'Offer', price: Number(price).toFixed(2), priceCurrency: 'EUR',
          availability: product.variants?.some((v: any) => v.stock > 0) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        },
      }) }} />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
        {/* Breadcrumbs — pure HTML, no JS */}
        <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-6 overflow-x-auto bg-muted/30 py-2 rounded-lg px-3" aria-label="Breadcrumb">
          <Link href={`/${locale}`} className="hover:text-foreground whitespace-nowrap">Home</Link>
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 rtl-flip" />
          {categoryName && (
            <>
              <span className="whitespace-nowrap">{categoryName}</span>
              <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 rtl-flip" />
            </>
          )}
          <span className="text-foreground font-medium truncate">{name}</span>
        </nav>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
          {/* Left: Primary image rendered server-side for instant LCP */}
          <div>
            {primaryImage ? (
              <div className="relative aspect-square rounded-2xl overflow-hidden bg-muted">
                <Image
                  src={primaryImage}
                  alt={name}
                  fill
                  priority
                  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 600px"
                  className="object-cover"
                />
              </div>
            ) : (
              <div className="aspect-square rounded-2xl bg-muted flex items-center justify-center">
                <span className="text-4xl font-bold text-muted-foreground/20">{name.charAt(0).toUpperCase()}</span>
              </div>
            )}
            {/* Client-side gallery with thumbnails + zoom replaces this on hydration */}
            <div id="gallery-mount" />
          </div>

          {/* Right: Product info */}
          <div className="space-y-6">
            {categoryName && <p className="text-sm text-muted-foreground">{categoryName}</p>}
            <h1 className="text-2xl sm:text-3xl font-bold">{name}</h1>

            {/* Price — rendered server-side */}
            <div className="flex items-baseline gap-3">
              <span className={`text-3xl font-bold ${hasDiscount ? 'text-accent' : ''}`}>
                &euro;{Number(price).toFixed(2)}
              </span>
              {hasDiscount && (
                <>
                  <span className="text-lg text-muted-foreground line-through">&euro;{Number(product.basePrice).toFixed(2)}</span>
                  <span className="px-2 py-0.5 rounded bg-destructive text-destructive-foreground text-xs font-semibold">-{discountPercent}%</span>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground -mt-4">{t('priceIncludesVat', { rate: Number(product.taxRate).toFixed(0) })}</p>

            {/* Delivery — server-rendered */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="text-base">📦</span>
              <span>{t('deliveryEstimate')} <strong className="text-foreground">{deliveryDate}</strong></span>
            </div>

            {/* Client-side interactive parts */}
            <ProductClient
              product={product}
              locale={locale}
              translations={{
                color: t('color'),
                size: t('size'),
                inStock: t('inStock'),
                lowStock: t('lowStock', { count: 0 }),
                outOfStock: t('outOfStock'),
                addToCart: t('addToCart'),
                added: t('added'),
                addToWishlist: t('addToWishlist'),
                share: t('share'),
                copyLink: t('copyLink'),
              }}
            />
          </div>
        </div>

        {/* Description — server-rendered HTML, no JS */}
        <div className="mt-12 bg-muted/20 rounded-2xl p-6">
          <h2 className="text-lg font-bold mb-4">{t('description')}</h2>
          <div className="prose prose-sm max-w-none text-muted-foreground">
            {description ? <p>{description}</p> : <p className="italic">{t('noDescription')}</p>}
          </div>
        </div>

        {/* Similar Products — server-rendered */}
        {filteredSimilar.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xl font-bold mb-4">{tHome('alsoLike')}</h2>
            <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide -mx-4 px-4">
              {filteredSimilar.map((sp: any) => {
                const spName = sp.name ?? sp.translations?.[0]?.name ?? sp.slug
                const spImage = sp.images?.find((i: any) => i.isPrimary)?.url ?? sp.images?.[0]?.url ?? sp.imageUrl
                const spPrice = sp.salePrice ?? sp.basePrice
                return (
                  <Link key={sp.id} href={`/${locale}/products/${sp.slug}`} className="flex-shrink-0 w-[200px] sm:w-[240px] snap-start group" aria-label={spName}>
                    <div className="aspect-square rounded-lg bg-muted overflow-hidden relative">
                      {spImage && <Image src={spImage} alt={spName} fill sizes="240px" className="object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />}
                    </div>
                    <p className="mt-2 text-sm font-medium truncate group-hover:text-primary">{spName}</p>
                    <p className="text-sm font-bold">&euro;{Number(spPrice).toFixed(2)}</p>
                  </Link>
                )
              })}
            </div>
          </section>
        )}
      </div>
    </>
  )
}
