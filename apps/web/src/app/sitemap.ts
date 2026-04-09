import { MetadataRoute } from 'next'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://malak-bekleidung.com'
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
const LOCALES = ['de', 'ar', 'en']

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = []
  const now = new Date()

  // Static pages
  const staticPages = [
    { path: '', priority: 1.0, changeFrequency: 'daily' as const },
    { path: '/products', priority: 0.9, changeFrequency: 'daily' as const },
    { path: '/lookbook', priority: 0.7, changeFrequency: 'weekly' as const },
    { path: '/about', priority: 0.6, changeFrequency: 'monthly' as const },
    { path: '/contact', priority: 0.5, changeFrequency: 'monthly' as const },
    { path: '/sale', priority: 0.8, changeFrequency: 'daily' as const },
    { path: '/legal/impressum', priority: 0.3, changeFrequency: 'yearly' as const },
    { path: '/legal/agb', priority: 0.3, changeFrequency: 'yearly' as const },
    { path: '/legal/datenschutz', priority: 0.3, changeFrequency: 'yearly' as const },
    { path: '/legal/widerruf', priority: 0.3, changeFrequency: 'yearly' as const },
  ]

  for (const page of staticPages) {
    for (const locale of LOCALES) {
      entries.push({
        url: `${BASE_URL}/${locale}${page.path}`,
        lastModified: now,
        changeFrequency: page.changeFrequency,
        priority: page.priority,
      })
    }
  }

  // Dynamic product pages
  try {
    const res = await fetch(`${API_URL}/api/v1/products?limit=500&sort=newest`, {
      next: { revalidate: 3600 },
    })
    if (res.ok) {
      const data = await res.json()
      const products = data?.data ?? data?.items ?? data ?? []

      for (const product of products) {
        if (!product.isActive) continue
        for (const locale of LOCALES) {
          entries.push({
            url: `${BASE_URL}/${locale}/products/${product.slug}`,
            lastModified: product.updatedAt ? new Date(product.updatedAt) : now,
            changeFrequency: 'weekly',
            priority: 0.8,
          })
        }
      }
    }
  } catch {
    // If API is not available, just return static pages
  }

  // Category pages
  try {
    const res = await fetch(`${API_URL}/api/v1/categories`, { next: { revalidate: 3600 } })
    if (res.ok) {
      const categories = await res.json()
      for (const cat of categories ?? []) {
        for (const locale of LOCALES) {
          entries.push({
            url: `${BASE_URL}/${locale}/products?category=${cat.slug}`,
            lastModified: now,
            changeFrequency: 'daily',
            priority: 0.7,
          })
        }
      }
    }
  } catch {}

  return entries
}
