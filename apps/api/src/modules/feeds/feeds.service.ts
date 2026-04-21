import { Injectable, Logger, Optional, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { EmailService } from '../email/email.service'
import { registerChannelFeedCache } from '../../common/helpers/channel-feed-cache-ref'
import { channelUtmParams } from '../../common/helpers/channel-utm'
import * as Sentry from '@sentry/nestjs'

interface FeedProduct {
  id: string
  itemGroupId: string | null
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
  // C6 — raw Google Product Taxonomy ID for this product's category.
  // Null = category has no mapping yet; feed falls back to category name
  // (pre-C6 behaviour, Google accepts but downgrades listings).
  googleCategoryId: string | null
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
export class FeedsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FeedsService.name)
  private cache = new Map<string, { data: string; stats: FeedStats; generatedAt: Date }>()
  private readonly CACHE_TTL = 30 * 60 * 1000 // 30 minutes
  private accessLog: { date: Date; ip: string; feed: string }[] = []

  constructor(
    private readonly prisma: PrismaService,
    // EmailService is @Optional() so existing unit-test construction
    // `new FeedsService(mockPrisma)` keeps working without providing an
    // email mock. Production wiring injects it via FeedsModule / AppModule.
    // Used only on hard-fail (no cache available) to alert the admin.
    @Optional() private readonly email?: EmailService | null,
  ) {}

  // Register this instance as the active cache-holder so writers in
  // other modules (AdminProductsService, AdminController) can invoke
  // invalidateChannelFeedCache() without going through DI. Mirrors the
  // static-helper pattern of revalidateProductTags.
  onModuleInit(): void {
    registerChannelFeedCache(this)
  }

  onModuleDestroy(): void {
    registerChannelFeedCache(null)
  }

  // ── Failure handling ─────────────────────────────────────────
  //
  // Called from the outer catch in every getXFeed method. Two tiers:
  //   1. stale cache available → return it, Sentry.captureMessage at
  //      WARNING level so ops sees degraded operation but doesn't page
  //   2. no cache available → throw so the controller returns 503
  //      Service Unavailable, Sentry.captureException at ERROR level,
  //      queue a German admin email (best-effort)
  // This method never itself throws — it either returns stale data or
  // re-throws the original error.
  private handleFailure<T extends { data: string; stats: FeedStats }>(
    channel: 'facebook' | 'tiktok' | 'google' | 'whatsapp',
    cacheKey: string,
    stale: { data: string; stats: FeedStats; generatedAt: Date } | undefined,
    err: unknown,
  ): T {
    const message = err instanceof Error ? err.message : String(err)
    if (stale) {
      this.logger.warn(
        `Feed ${channel} generation failed, serving stale cache from ${stale.generatedAt.toISOString()}: ${message}`,
      )
      Sentry.captureMessage(`Feed ${channel} degraded (stale cache served): ${message}`, {
        level: 'warning',
        tags: { feature: 'feeds', channel, cacheKey },
      })
      return { data: stale.data, stats: stale.stats } as T
    }
    // Hard fail — no safety net.
    this.logger.error(`Feed ${channel} HARD FAIL (no cache fallback): ${message}`)
    Sentry.captureException(err instanceof Error ? err : new Error(message), {
      level: 'error',
      tags: { feature: 'feeds', channel, cacheKey, severity: 'hard_fail' },
    })
    this.notifyHardFail(channel, message).catch(() => {
      /* notification itself must never take down the feed — log only */
    })
    throw err
  }

  private async notifyHardFail(channel: string, message: string): Promise<void> {
    if (!this.email) return
    // Best-effort — we reuse the BACKUP_FAILED template shape (simple
    // admin-alert, DE-only, German-only per spec Q2 + backup-system
    // convention). A dedicated FEED_FAILED template can be added later;
    // for now we stay minimal and use a plain transactional payload.
    const to = process.env.BACKUP_ALERT_EMAIL ?? process.env.EMAIL_FROM_ADMIN
    if (!to) {
      this.logger.warn('BACKUP_ALERT_EMAIL not set — skipping feed-failure email')
      return
    }
    await this.email.enqueue({
      to,
      type: 'backup-failed' as any,
      lang: 'de',
      data: {
        backupType: `FEED_${channel.toUpperCase()}`, // reuse template variable
        errorMessage: message.slice(0, 1000),
        timestampStr: new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }),
        dashboardUrl: `${process.env.APP_URL ?? 'https://malak-bekleidung.com'}/de/admin/channels`,
      },
    })
  }

  // ── Feed Token — Per-Channel (C6, user P8) ──────────────────
  //
  // Every channel has its own token in SalesChannelConfig.feedToken.
  // No legacy fallback to the global `shop_settings.feed_token`: on a
  // clean install the reader accepts only per-channel tokens, and
  // rotating one channel doesn't invalidate the others. The legacy
  // setting row stays in the DB (no hard delete per Q4b) but nothing
  // in the code reads it anymore.
  //
  // Lazy init: if the channel has no token yet, generate one on first
  // read. Keeps tests and cold-start paths simple.

  async getFeedTokenForChannel(channel: 'facebook' | 'tiktok' | 'google' | 'whatsapp'): Promise<string> {
    const existing = await this.prisma.salesChannelConfig.findUnique({
      where: { channel: channel as any },
      select: { feedToken: true },
    })
    if (existing?.feedToken) return existing.feedToken
    const token = this.generateToken()
    await this.prisma.salesChannelConfig.upsert({
      where: { channel: channel as any },
      create: { channel: channel as any, feedToken: token },
      update: { feedToken: token },
    })
    return token
  }

  async validateTokenForChannel(channel: 'facebook' | 'tiktok' | 'google' | 'whatsapp', token: string): Promise<boolean> {
    const cfg = await this.prisma.salesChannelConfig.findUnique({
      where: { channel: channel as any },
      select: { feedToken: true },
    })
    // Reject if no token has been set yet AND the caller sent one —
    // admin must explicitly rotate/create a token before exposing
    // the feed URL.
    return cfg?.feedToken != null && cfg.feedToken === token
  }

  async regenerateTokenForChannel(channel: 'facebook' | 'tiktok' | 'google' | 'whatsapp'): Promise<string> {
    const token = this.generateToken()
    await this.prisma.salesChannelConfig.upsert({
      where: { channel: channel as any },
      create: { channel: channel as any, feedToken: token },
      update: { feedToken: token },
    })
    return token
  }

  /**
   * Legacy wrappers — used by tests and by feeds-byte-equal snapshot.
   * Delegate to the facebook channel for backward compatibility.
   * Removed in Phase 4 once no callers remain.
   *
   * @deprecated — use getFeedTokenForChannel / validateTokenForChannel
   */
  async getFeedToken(): Promise<string> {
    return this.getFeedTokenForChannel('facebook')
  }
  async validateToken(token: string): Promise<boolean> {
    return this.validateTokenForChannel('facebook', token)
  }
  async regenerateToken(): Promise<string> {
    return this.regenerateTokenForChannel('facebook')
  }

  private generateToken(): string {
    return Array.from({ length: 32 }, () => Math.random().toString(36).charAt(2)).join('')
  }

  // ── Product Data ─────────────────────────────────────────────

  private async getProducts(lang: string = 'de', channel?: 'facebook' | 'tiktok' | 'google' | 'whatsapp'): Promise<{ products: FeedProduct[]; stats: FeedStats }> {
    const appUrl = process.env.APP_URL || 'http://localhost:3000'

    // C6 Reader-Cut (Q1a): query via ChannelProductListing instead of
    // Product.channelX booleans. `some` relation-query — Prisma-native,
    // one SQL round-trip. Status filter Q2(c): pending + active are
    // both shown in feeds (paused / rejected / deleted are hidden).
    //
    // The boolean fields are STILL written by C4's dual-write, so a
    // consistent DB has identical sets for both queries. Byte-equal
    // regression guard (feeds-byte-equal.spec.ts) locks the output
    // shape, proving the cut-over is transparent for external crawlers.
    const where: any = {
      isActive: true,
      deletedAt: null,
    }
    if (channel) {
      where.channelListings = {
        some: {
          channel,
          status: { in: ['active', 'pending'] },
        },
      }
    }

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
            itemGroupId: p.id,
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
            googleCategoryId: p.category?.googleCategoryId ?? null,
            color: v.color,
            size: v.size,
            sku: v.sku,
            condition: 'new',
          })
        }
      } else {
        products.push({
          id: p.id,
          itemGroupId: null,
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
          googleCategoryId: p.category?.googleCategoryId ?? null,
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

    try {
    const { products, stats } = await this.getProducts(lang, 'facebook')
    const utmParams = channelUtmParams('facebook')

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n<channel>\n<title>Malak Bekleidung</title>\n<link>${process.env.APP_URL || ''}</link>\n<description>Malak Bekleidung — Mode für die ganze Familie</description>\n`

    for (const p of products) {
      xml += `<item>\n`
      xml += `  <g:id>${this.escapeXml(p.id)}</g:id>\n`
      if (p.itemGroupId) xml += `  <g:item_group_id>${this.escapeXml(p.itemGroupId)}</g:item_group_id>\n`
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
    } catch (err) {
      const res = this.handleFailure<{ data: string; stats: FeedStats }>('facebook', cacheKey, cached, err)
      return { xml: res.data, stats: res.stats }
    }
  }

  // ── TikTok Feed (CSV) ────────────────────────────────────────

  async getTikTokFeed(lang: string = 'de', force = false): Promise<{ csv: string; stats: FeedStats }> {
    const cacheKey = `tiktok_${lang}`
    const cached = this.cache.get(cacheKey)
    if (cached && !force && Date.now() - cached.generatedAt.getTime() < this.CACHE_TTL) {
      return { csv: cached.data, stats: cached.stats }
    }

    try {
    const { products, stats } = await this.getProducts(lang, 'tiktok')
    const utmParams = channelUtmParams('tiktok')

    const header = 'sku_id\ttitle\tdescription\tavailability\tcondition\tprice\tlink\timage_link\tbrand\tcolor\tsize\n'
    const rows = products.map((p) =>
      [p.sku, p.title, p.description.replace(/\t/g, ' '), p.availability, p.condition, p.price, `${p.link}?${utmParams}`, p.imageUrl, p.brand, p.color ?? '', p.size ?? ''].join('\t')
    ).join('\n')

    const csv = header + rows
    this.cache.set(cacheKey, { data: csv, stats, generatedAt: new Date() })
    return { csv, stats }
    } catch (err) {
      const res = this.handleFailure<{ data: string; stats: FeedStats }>('tiktok', cacheKey, cached, err)
      return { csv: res.data, stats: res.stats }
    }
  }

  // ── Google Shopping Feed (XML) ───────────────────────────────

  async getGoogleFeed(lang: string = 'de', force = false): Promise<{ xml: string; stats: FeedStats }> {
    const cacheKey = `google_${lang}`
    const cached = this.cache.get(cacheKey)
    if (cached && !force && Date.now() - cached.generatedAt.getTime() < this.CACHE_TTL) {
      return { xml: cached.data, stats: cached.stats }
    }

    try {
    const { products, stats } = await this.getProducts(lang, 'google')
    const utmParams = channelUtmParams('google')

    // C6 — pull active shipping zones once. Each zone becomes one or
    // more <g:shipping> blocks (one per country code), so Google
    // shows customers the correct country-specific rate. Previously
    // hardcoded DE / 4.99 EUR which ignored every multi-country
    // setup. Free-shipping threshold is NOT emitted here (Google
    // Shopping supports it via a separate <g:shipping> variant but
    // that's a post-launch enhancement).
    const shippingZones = await this.prisma.shippingZone.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { basePrice: 'asc' },
    })
    const shippingBlock = shippingZones.flatMap((z) =>
      z.countryCodes.map((cc: string) =>
        `  <g:shipping>\n    <g:country>${this.escapeXml(cc)}</g:country>\n    <g:price>${Number(z.basePrice).toFixed(2)} EUR</g:price>\n  </g:shipping>\n`,
      ),
    ).join('')

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n<channel>\n<title>Malak Bekleidung</title>\n<link>${process.env.APP_URL || ''}</link>\n`

    for (const p of products) {
      xml += `<item>\n`
      xml += `  <g:id>${this.escapeXml(p.sku)}</g:id>\n`
      if (p.itemGroupId) xml += `  <g:item_group_id>${this.escapeXml(p.itemGroupId)}</g:item_group_id>\n`
      xml += `  <title>${this.escapeXml(p.title)}</title>\n`
      xml += `  <description>${this.escapeXml(p.description)}</description>\n`
      xml += `  <link>${p.link}?${utmParams}</link>\n`
      xml += `  <g:image_link>${this.escapeXml(p.imageUrl)}</g:image_link>\n`
      for (const img of p.additionalImages) { xml += `  <g:additional_image_link>${this.escapeXml(img)}</g:additional_image_link>\n` }
      xml += `  <g:price>${p.price}</g:price>\n`
      if (p.salePrice) xml += `  <g:sale_price>${p.salePrice}</g:sale_price>\n`
      xml += `  <g:availability>${p.availability}</g:availability>\n`
      xml += `  <g:brand>${this.escapeXml(p.brand)}</g:brand>\n`
      // C6 — prefer taxonomy ID if mapped, otherwise fall back to
      // category name (legacy behaviour — Google accepts both but
      // downgrades name-only listings).
      if (p.googleCategoryId) {
        xml += `  <g:google_product_category>${this.escapeXml(p.googleCategoryId)}</g:google_product_category>\n`
      } else if (p.category) {
        xml += `  <g:google_product_category>${this.escapeXml(p.category)}</g:google_product_category>\n`
      }
      if (p.color) xml += `  <g:color>${this.escapeXml(p.color)}</g:color>\n`
      if (p.size) xml += `  <g:size>${this.escapeXml(p.size)}</g:size>\n`
      xml += `  <g:condition>${p.condition}</g:condition>\n`
      xml += `  <g:mpn>${this.escapeXml(p.sku)}</g:mpn>\n`
      xml += shippingBlock
      xml += `</item>\n`
    }

    xml += `</channel>\n</rss>`

    this.cache.set(cacheKey, { data: xml, stats, generatedAt: new Date() })
    return { xml, stats }
    } catch (err) {
      const res = this.handleFailure<{ data: string; stats: FeedStats }>('google', cacheKey, cached, err)
      return { xml: res.data, stats: res.stats }
    }
  }

  // ── WhatsApp Business Catalog Feed — REMOVED in C7 ──────────
  //
  // The Meta Graph WhatsApp Catalog API is not callable without a
  // proper Commerce integration (admin OAuth + Catalog ID setup).
  // Pre-C7 the /feeds/whatsapp endpoint produced JSON that nobody
  // was reading (Meta does not poll third-party URLs for Catalog
  // data). Removing the fake surface prevents the "Fassade"
  // anti-pattern the user explicitly flagged in the Phase-1 plan.
  //
  // Replacement: WhatsAppShareButton in the product editor generates
  // a copy-paste-ready message the admin pastes into WhatsApp
  // Business Catalog manually. See components/admin/whatsapp-share-
  // button.tsx. Product.channelWhatsapp stays in the schema (default
  // false as of C7/FA-05) and gates the share-button visibility.
  //
  // The /feeds/whatsapp endpoint now returns 410 Gone (controller).

  // ── Stats & Monitoring ───────────────────────────────────────

  async getFeedStats(): Promise<Record<string, { generatedAt: Date | null; productCount: number; stats: FeedStats | null }>> {
    const result: Record<string, any> = {}
    for (const [key, cached] of this.cache.entries()) {
      result[key] = { generatedAt: cached.generatedAt, productCount: cached.stats.exported, stats: cached.stats }
    }
    // If no cache, generate stats per channel in parallel. C7 removed
    // WhatsApp from the feed reader — it's handled via the
    // WhatsAppShareButton admin tool, not a polled catalog.
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
