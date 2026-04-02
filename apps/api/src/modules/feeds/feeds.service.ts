import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

interface FeedProduct {
  id: string
  title: string
  description: string
  link: string
  imageUrl: string
  additionalImages: string[]
  price: string
  salePrice: string | null
  currency: string
  availability: string
  brand: string
  category: string
  color: string | null
  size: string | null
  sku: string
  condition: string
}

interface FeedStats {
  total: number
  exported: number
  skipped: { noImage: number; noPrice: number; inactive: number }
}

@Injectable()
export class FeedsService {
  private cache = new Map<string, { data: string; stats: FeedStats; generatedAt: Date }>()
  private readonly CACHE_TTL = 30 * 60 * 1000 // 30 minutes
  private accessLog: { date: Date; ip: string; feed: string }[] = []

  constructor(private readonly prisma: PrismaService) {}

  // ── Feed Token ───────────────────────────────────────────────

  async getFeedToken(): Promise<string> {
    let setting = await this.prisma.shopSetting.findFirst({ where: { key: 'feed_token' } })
    if (!setting) {
      const token = this.generateToken()
      setting = await this.prisma.shopSetting.create({ data: { key: 'feed_token', value: token } })
    }
    return setting.value
  }

  async validateToken(token: string): Promise<boolean> {
    const stored = await this.getFeedToken()
    return token === stored
  }

  async regenerateToken(): Promise<string> {
    const token = this.generateToken()
    await this.prisma.shopSetting.upsert({
      where: { key: 'feed_token' },
      create: { key: 'feed_token', value: token },
      update: { value: token },
    })
    return token
  }

  private generateToken(): string {
    return Array.from({ length: 32 }, () => Math.random().toString(36).charAt(2)).join('')
  }

  // ── Product Data ─────────────────────────────────────────────

  private async getProducts(lang: string = 'de', channel?: 'facebook' | 'tiktok' | 'google'): Promise<{ products: FeedProduct[]; stats: FeedStats }> {
    const appUrl = process.env.APP_URL || 'http://localhost:3000'

    const where: any = { isActive: true, deletedAt: null }
    if (channel === 'facebook') where.channelFacebook = true
    else if (channel === 'tiktok') where.channelTiktok = true
    else if (channel === 'google') where.channelGoogle = true

    const rawProducts = await this.prisma.product.findMany({
      where,
      include: {
        translations: true,
        variants: { where: { isActive: true }, include: { inventory: { select: { quantityOnHand: true, quantityReserved: true } } } },
        images: { orderBy: { sortOrder: 'asc' } },
        category: { include: { translations: true } },
      },
    })

    const stats: FeedStats = { total: rawProducts.length, exported: 0, skipped: { noImage: 0, noPrice: 0, inactive: 0 } }
    const products: FeedProduct[] = []

    for (const p of rawProducts) {
      // Skip: no images
      if (!p.images.length) { stats.skipped.noImage++; continue }

      // Skip: no price
      const price = Number(p.salePrice ?? p.basePrice)
      if (price <= 0) { stats.skipped.noPrice++; continue }

      const translation = p.translations.find((t) => t.language === lang) ?? p.translations[0]
      if (!translation) continue

      const catTranslation = p.category?.translations?.find((t) => t.language === lang) ?? p.category?.translations?.[0]

      // Calculate availability
      const totalStock = p.variants.reduce((sum, v) => sum + v.inventory.reduce((s, i) => s + i.quantityOnHand - i.quantityReserved, 0), 0)

      // Get slug for URL
      const slug = p.slug

      // For each variant (or just main product if no variants)
      if (p.variants.length > 0) {
        for (const v of p.variants) {
          const variantStock = v.inventory.reduce((s, i) => s + i.quantityOnHand - i.quantityReserved, 0)
          const variantPrice = price + Number(v.priceModifier)

          const variantSalePrice = p.salePrice ? Number(p.salePrice) + Number(v.priceModifier) : null

          products.push({
            id: `${p.id}_${v.id}`,
            title: translation.name + (v.color ? ` - ${v.color}` : '') + (v.size ? ` ${v.size}` : ''),
            description: translation.description ?? translation.name,
            link: `${appUrl}/${lang}/products/${slug}`,
            imageUrl: p.images[0]?.url ?? '',
            additionalImages: p.images.slice(1, 5).map((i) => i.url),
            price: `${variantPrice.toFixed(2)} EUR`,
            salePrice: variantSalePrice ? `${variantSalePrice.toFixed(2)} EUR` : null,
            currency: 'EUR',
            availability: variantStock > 0 ? 'in stock' : 'out of stock',
            brand: p.brand ?? 'Malak',
            category: catTranslation?.name ?? '',
            color: v.color,
            size: v.size,
            sku: v.sku,
            condition: 'new',
          })
        }
      } else {
        products.push({
          id: p.id,
          title: translation.name,
          description: translation.description ?? translation.name,
          link: `${appUrl}/${lang}/products/${slug}`,
          imageUrl: p.images[0]?.url ?? '',
          additionalImages: p.images.slice(1, 5).map((i) => i.url),
          price: `${price.toFixed(2)} EUR`,
          salePrice: p.salePrice ? `${Number(p.salePrice).toFixed(2)} EUR` : null,
          currency: 'EUR',
          availability: totalStock > 0 ? 'in stock' : 'out of stock',
          brand: p.brand ?? 'Malak',
          category: catTranslation?.name ?? '',
          color: null,
          size: null,
          sku: slug,
          condition: 'new',
        })
      }
    }

    stats.exported = products.length
    return { products, stats }
  }

  // ── Facebook / Instagram Feed (XML) ──────────────────────────

  async getFacebookFeed(lang: string = 'de', force = false): Promise<{ xml: string; stats: FeedStats }> {
    const cacheKey = `facebook_${lang}`
    const cached = this.cache.get(cacheKey)
    if (cached && !force && Date.now() - cached.generatedAt.getTime() < this.CACHE_TTL) {
      return { xml: cached.data, stats: cached.stats }
    }

    const { products, stats } = await this.getProducts(lang, 'facebook')
    const utmParams = 'utm_source=facebook&utm_medium=shop&utm_campaign=catalog'

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n<channel>\n<title>Malak Bekleidung</title>\n<link>${process.env.APP_URL || ''}</link>\n<description>Malak Bekleidung — Mode für die ganze Familie</description>\n`

    for (const p of products) {
      xml += `<item>\n`
      xml += `  <g:id>${this.escapeXml(p.id)}</g:id>\n`
      xml += `  <g:title>${this.escapeXml(p.title)}</g:title>\n`
      xml += `  <g:description>${this.escapeXml(p.description)}</g:description>\n`
      xml += `  <g:link>${p.link}?${utmParams}</g:link>\n`
      xml += `  <g:image_link>${this.escapeXml(p.imageUrl)}</g:image_link>\n`
      for (const img of p.additionalImages) { xml += `  <g:additional_image_link>${this.escapeXml(img)}</g:additional_image_link>\n` }
      xml += `  <g:price>${p.price}</g:price>\n`
      if (p.salePrice) xml += `  <g:sale_price>${p.salePrice}</g:sale_price>\n`
      xml += `  <g:availability>${p.availability}</g:availability>\n`
      xml += `  <g:brand>${this.escapeXml(p.brand)}</g:brand>\n`
      if (p.category) xml += `  <g:product_type>${this.escapeXml(p.category)}</g:product_type>\n`
      if (p.color) xml += `  <g:color>${this.escapeXml(p.color)}</g:color>\n`
      if (p.size) xml += `  <g:size>${this.escapeXml(p.size)}</g:size>\n`
      xml += `  <g:condition>${p.condition}</g:condition>\n`
      xml += `  <g:mpn>${this.escapeXml(p.sku)}</g:mpn>\n`
      xml += `</item>\n`
    }

    xml += `</channel>\n</rss>`

    this.cache.set(cacheKey, { data: xml, stats, generatedAt: new Date() })
    return { xml, stats }
  }

  // ── TikTok Feed (CSV) ────────────────────────────────────────

  async getTikTokFeed(lang: string = 'de', force = false): Promise<{ csv: string; stats: FeedStats }> {
    const cacheKey = `tiktok_${lang}`
    const cached = this.cache.get(cacheKey)
    if (cached && !force && Date.now() - cached.generatedAt.getTime() < this.CACHE_TTL) {
      return { csv: cached.data, stats: cached.stats }
    }

    const { products, stats } = await this.getProducts(lang, 'tiktok')
    const utmParams = 'utm_source=tiktok&utm_medium=shop&utm_campaign=catalog'

    const header = 'sku_id\ttitle\tdescription\tavailability\tcondition\tprice\tlink\timage_link\tbrand\tcolor\tsize\n'
    const rows = products.map((p) =>
      [p.sku, p.title, p.description.replace(/\t/g, ' '), p.availability, p.condition, p.price, `${p.link}?${utmParams}`, p.imageUrl, p.brand, p.color ?? '', p.size ?? ''].join('\t')
    ).join('\n')

    const csv = header + rows
    this.cache.set(cacheKey, { data: csv, stats, generatedAt: new Date() })
    return { csv, stats }
  }

  // ── Google Shopping Feed (XML) ───────────────────────────────

  async getGoogleFeed(lang: string = 'de', force = false): Promise<{ xml: string; stats: FeedStats }> {
    const cacheKey = `google_${lang}`
    const cached = this.cache.get(cacheKey)
    if (cached && !force && Date.now() - cached.generatedAt.getTime() < this.CACHE_TTL) {
      return { xml: cached.data, stats: cached.stats }
    }

    const { products, stats } = await this.getProducts(lang, 'google')
    const utmParams = 'utm_source=google&utm_medium=shopping&utm_campaign=feed'

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n<channel>\n<title>Malak Bekleidung</title>\n<link>${process.env.APP_URL || ''}</link>\n`

    for (const p of products) {
      xml += `<item>\n`
      xml += `  <g:id>${this.escapeXml(p.sku)}</g:id>\n`
      xml += `  <title>${this.escapeXml(p.title)}</title>\n`
      xml += `  <description>${this.escapeXml(p.description)}</description>\n`
      xml += `  <link>${p.link}?${utmParams}</link>\n`
      xml += `  <g:image_link>${this.escapeXml(p.imageUrl)}</g:image_link>\n`
      for (const img of p.additionalImages) { xml += `  <g:additional_image_link>${this.escapeXml(img)}</g:additional_image_link>\n` }
      xml += `  <g:price>${p.price}</g:price>\n`
      if (p.salePrice) xml += `  <g:sale_price>${p.salePrice}</g:sale_price>\n`
      xml += `  <g:availability>${p.availability}</g:availability>\n`
      xml += `  <g:brand>${this.escapeXml(p.brand)}</g:brand>\n`
      if (p.category) xml += `  <g:google_product_category>${this.escapeXml(p.category)}</g:google_product_category>\n`
      if (p.color) xml += `  <g:color>${this.escapeXml(p.color)}</g:color>\n`
      if (p.size) xml += `  <g:size>${this.escapeXml(p.size)}</g:size>\n`
      xml += `  <g:condition>${p.condition}</g:condition>\n`
      xml += `  <g:mpn>${this.escapeXml(p.sku)}</g:mpn>\n`
      xml += `  <g:shipping>\n    <g:country>DE</g:country>\n    <g:price>4.99 EUR</g:price>\n  </g:shipping>\n`
      xml += `</item>\n`
    }

    xml += `</channel>\n</rss>`

    this.cache.set(cacheKey, { data: xml, stats, generatedAt: new Date() })
    return { xml, stats }
  }

  // ── Stats & Monitoring ───────────────────────────────────────

  async getFeedStats(): Promise<Record<string, { generatedAt: Date | null; productCount: number; stats: FeedStats | null }>> {
    const result: Record<string, any> = {}
    for (const [key, cached] of this.cache.entries()) {
      result[key] = { generatedAt: cached.generatedAt, productCount: cached.stats.exported, stats: cached.stats }
    }
    // If no cache, generate stats per channel in parallel
    const missing: { key: string; channel: 'facebook' | 'tiktok' | 'google' }[] = []
    if (!result.facebook_de) missing.push({ key: 'facebook_de', channel: 'facebook' })
    if (!result.tiktok_de) missing.push({ key: 'tiktok_de', channel: 'tiktok' })
    if (!result.google_de) missing.push({ key: 'google_de', channel: 'google' })
    if (missing.length) {
      const results = await Promise.all(missing.map((m) => this.getProducts('de', m.channel)))
      for (let i = 0; i < missing.length; i++) {
        result[missing[i].key] = { generatedAt: null, productCount: results[i].stats.exported, stats: results[i].stats }
      }
    }
    return result
  }

  logAccess(ip: string, feed: string) {
    this.accessLog.push({ date: new Date(), ip, feed })
    if (this.accessLog.length > 1000) this.accessLog = this.accessLog.slice(-500)
  }

  getAccessLog() {
    return this.accessLog.slice(-100).reverse()
  }

  clearCache() {
    this.cache.clear()
  }

  // ── Helpers ──────────────────────────────────────────────────

  private escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  }
}
