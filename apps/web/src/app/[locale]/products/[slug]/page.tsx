import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { ProductClient } from './product-client'
import { generateProductOGTags } from '@/components/product-og-tags'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

async function getProduct(slug: string, lang: string) {
  const res = await fetch(`${API_URL}/api/v1/products/${slug}?lang=${lang}`, {
    next: { revalidate: 10 },
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

export async function generateMetadata({ params: { slug, locale } }: { params: { slug: string; locale: string } }) {
  const product = await getProduct(slug, locale)
  if (!product) return { title: 'Not Found' }
  const name = product.name ?? product.translations?.[0]?.name ?? slug
  const description = product.description ?? product.translations?.[0]?.description ?? ''
  const image = product.images?.find((i: any) => i.isPrimary)?.url ?? product.images?.[0]?.url
  const price = Number(product.basePrice ?? 0)
  const salePrice = product.salePrice ? Number(product.salePrice) : null

  return generateProductOGTags({ name, description, price, salePrice, image, slug }, locale)
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

  const p = product as any
  const name = p.name ?? product.translations?.[0]?.name ?? product.slug
  const description = p.description ?? product.translations?.[0]?.description ?? ''
  const categoryName = product.category?.translations?.[0]?.name ?? (product.category as any)?.name
  const price = product.salePrice ?? product.basePrice
  const hasDiscount = product.salePrice && Number(product.salePrice) < Number(product.basePrice)
  const discountPercent = hasDiscount ? Math.round((1 - Number(product.salePrice) / Number(product.basePrice)) * 100) : 0
  const primaryImage = product.images?.find((i: any) => i.isPrimary)?.url ?? product.images?.[0]?.url
  const filteredSimilar = (similar ?? []).filter((sp: any) => sp.id !== product.id).slice(0, 8)

  const deliveryDate = (() => {
    const d = new Date()
    let days = 3
    while (days > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) days-- }
    return d.toLocaleDateString(locale === 'de' ? 'de-DE' : locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'long' })
  })()

  return (
    <>
      {/* JSON-LD */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        '@context': 'https://schema.org', '@type': 'Product', name, image: primaryImage,
        description: description?.slice(0, 160),
        offers: { '@type': 'Offer', price: Number(price).toFixed(2), priceCurrency: 'EUR',
          availability: product.variants?.some((v: any) => v.stock > 0) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        },
      }) }} />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-6 overflow-x-auto bg-muted/30 py-2 rounded-lg px-3" aria-label="Breadcrumb">
          <Link href={`/${locale}`} className="hover:text-foreground whitespace-nowrap">Home</Link>
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 rtl-flip" />
          {categoryName && (<><span className="whitespace-nowrap">{categoryName}</span><ChevronRight className="h-3.5 w-3.5 flex-shrink-0 rtl-flip" /></>)}
          <span className="text-foreground font-medium truncate">{name}</span>
        </nav>

        {/* Product — Client Component handles gallery + interactions */}
        <ProductClient
          product={product}
          locale={locale}
          translations={{
            color: t('color'), size: t('size'),
            inStock: t('inStock'), outOfStock: t('outOfStock'),
            addToCart: t('addToCart'), added: t('added'),
            addToWishlist: t('addToWishlist'),
            share: t('share'), copyLink: t('copyLink'),
            priceIncludesVat: t('priceIncludesVat', { rate: Number(product.taxRate).toFixed(0) }),
            deliveryEstimate: t('deliveryEstimate'),
            description: t('description'), noDescription: t('noDescription'),
          }}
          computed={{
            name, description, categoryName, price: Number(price),
            hasDiscount: !!hasDiscount, discountPercent, deliveryDate,
            basePrice: Number(product.basePrice),
          }}
        />

        {/* Similar Products — server rendered */}
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
                      {spImage && <img src={spImage} alt={spName} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />}
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
