// Server component — generates Open Graph meta tags for product pages
// Usage: <ProductOGTags product={product} locale={locale} />

interface ProductOGProps {
  product: {
    name: string
    description?: string
    price: number
    salePrice?: number | null
    image?: string | null
    slug: string
  }
  locale: string
}

export function generateProductOGTags(product: ProductOGProps['product'], locale: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const url = `${appUrl}/${locale}/products/${product.slug}`
  const fallbackImage = `${appUrl}/logo.png`
  const imageUrl = product.image || fallbackImage

  return {
    title: product.name,
    description: product.description ?? product.name,
    openGraph: {
      title: product.name,
      description: product.description ?? product.name,
      url,
      type: 'website',
      images: [{ url: imageUrl, width: 800, height: 800, alt: product.name }],
      siteName: 'Malak Bekleidung',
      locale: locale === 'ar' ? 'ar_EG' : locale === 'en' ? 'en_US' : 'de_DE',
    },
    twitter: {
      card: 'summary_large_image',
      title: product.name,
      description: product.description ?? product.name,
      images: [imageUrl],
    },
    other: {
      'product:price:amount': String(product.salePrice ?? product.price),
      'product:price:currency': 'EUR',
      'og:price:amount': String(product.salePrice ?? product.price),
      'og:price:currency': 'EUR',
    },
  }
}
