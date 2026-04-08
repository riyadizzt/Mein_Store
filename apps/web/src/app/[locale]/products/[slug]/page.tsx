import { notFound } from 'next/navigation'
// Old PDP backup: product-client.tsx (untouched)
import Link from 'next/link'
import { ProductClientPremium } from './product-client-premium'
import { generateProductOGTags } from '@/components/product-og-tags'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

async function getProduct(slug: string, lang: string) {
  const res = await fetch(`${API_URL}/api/v1/products/${slug}?lang=${lang}`, {
    next: { revalidate: 10 },
  })
  if (!res.ok) return null
  return res.json()
}

async function getSimilarProducts(lang: string, categoryId?: string) {
  const params = new URLSearchParams({ lang, limit: '8', sort: 'newest' })
  if (categoryId) params.set('categoryId', categoryId)
  const res = await fetch(`${API_URL}/api/v1/products?${params}`, {
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
  const [product] = await Promise.all([
    getProduct(slug, locale),
  ])

  if (!product) notFound()

  const similar = await getSimilarProducts(locale, product.categoryId)

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

      {/* Premium PDP Layout */}
      <div className="mx-auto max-w-[1400px] px-5 sm:px-8 lg:px-12 pt-4 pb-8">

        {/* Minimal Breadcrumbs */}
        <nav className="flex items-center gap-2 text-[11px] tracking-[0.08em] text-[#0f1419]/25 mb-8 lg:mb-12" aria-label="Breadcrumb">
          <Link href={`/${locale}`} className="hover:text-[#0f1419]/50 transition-colors">
            {locale === 'ar' ? 'الرئيسية' : 'Home'}
          </Link>
          <span className="text-[#0f1419]/15">/</span>
          {categoryName && (
            <>
              <span className="hover:text-[#0f1419]/50 transition-colors">{categoryName}</span>
              <span className="text-[#0f1419]/15">/</span>
            </>
          )}
          <span className="text-[#0f1419]/50 truncate max-w-[200px]">{name}</span>
        </nav>

        {/* Product */}
        <ProductClientPremium
          product={product}
          locale={locale}
          computed={{
            name, description, categoryName, price: Number(price),
            hasDiscount: !!hasDiscount, discountPercent, deliveryDate,
            basePrice: Number(product.basePrice),
          }}
          similarProducts={filteredSimilar}
        />
      </div>
    </>
  )
}
