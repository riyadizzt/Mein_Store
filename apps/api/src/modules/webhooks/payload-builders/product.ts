/**
 * Build the complete product.created webhook payload.
 *
 * Design principle: n8n should be able to auto-post this product to
 * Instagram / Facebook / TikTok WITHOUT a single callback to our API.
 * That means we include:
 *   - All 3 language names + descriptions (DE / EN / AR)
 *   - All image URLs (primary + rest)
 *   - All variant SKUs (for internal tracking)
 *   - Pre-built shop URLs for all 3 locales
 *   - Category name in all 3 languages
 *   - Gross price (already includes 19% German VAT)
 *
 * Pure function — takes a Prisma-like client + productId + appUrl,
 * returns the built payload or null if the product isn't found.
 * Never throws — caller wraps the call in .catch() for belt-and-suspenders.
 */
import type { ProductCreatedPayload } from '../events'

export async function buildProductCreatedPayload(
  prisma: any,
  productId: string,
  appUrl: string,
): Promise<ProductCreatedPayload | null> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      translations: true,
      images: { orderBy: { sortOrder: 'asc' }, select: { url: true } },
      variants: {
        where: { isActive: true },
        select: { id: true, sku: true, color: true, size: true, barcode: true },
      },
      category: {
        include: {
          translations: { select: { language: true, name: true } },
        },
      },
    },
  })
  if (!product) return null

  const findTranslation = (lang: 'de' | 'en' | 'ar') =>
    product.translations.find((t: any) => t.language === lang) ?? null

  const tDe = findTranslation('de')
  const tEn = findTranslation('en')
  const tAr = findTranslation('ar')

  const slug = product.slug as string

  const findCatName = (lang: 'de' | 'en' | 'ar') =>
    product.category?.translations?.find((t: any) => t.language === lang)?.name ?? null

  const imagesAll = (product.images ?? []).map((i: any) => i.url as string)
  const primary = imagesAll[0] ?? null

  const money = (n: number | string | { toString(): string }) => ({
    amount: Number(typeof n === 'number' ? n : n.toString()).toFixed(2),
    currency: 'EUR' as const,
  })

  return {
    productId: product.id,
    slug,
    brand: product.brand ?? 'Malak',
    category: product.category
      ? {
          id: product.category.id,
          slug: product.category.slug,
          nameDe: findCatName('de'),
          nameEn: findCatName('en'),
          nameAr: findCatName('ar'),
        }
      : null,
    basePrice: money(product.basePrice),
    salePrice: product.salePrice != null ? money(product.salePrice) : null,
    descriptions: {
      de: tDe ? { name: tDe.name, description: tDe.description ?? null } : null,
      en: tEn ? { name: tEn.name, description: tEn.description ?? null } : null,
      ar: tAr ? { name: tAr.name, description: tAr.description ?? null } : null,
    },
    images: {
      primary,
      all: imagesAll,
    },
    variants: (product.variants ?? []).map((v: any) => ({
      id: v.id,
      sku: v.sku,
      color: v.color ?? null,
      size: v.size ?? null,
      barcode: v.barcode,
    })),
    urls: {
      de: `${appUrl}/de/products/${slug}`,
      en: `${appUrl}/en/products/${slug}`,
      ar: `${appUrl}/ar/products/${slug}`,
    },
    createdAt: product.createdAt.toISOString(),
    adminUrl: `${appUrl}/de/admin/products/${product.id}`,
  }
}
