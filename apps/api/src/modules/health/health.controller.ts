import { Controller, Get, Query } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger'
import { PrismaService } from '../../prisma/prisma.service'

// Public settings endpoint — no auth needed, cached by frontend
@Controller('settings')
export class PublicSettingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('public')
  @ApiOperation({ summary: 'Public shop settings (cacheable)' })
  async getPublicSettings() {
    const rows = await this.prisma.shopSetting.findMany()
    const s: Record<string, string> = {}
    for (const r of rows) s[r.key] = r.value

    return {
      brandName: s.brandName || 'MALAK',
      logoUrl: s.logoUrl || '',
      faviconUrl: s.faviconUrl || '',
      accentColor: s.accentColor || '',
      currency: s.currency || 'EUR',
      heroBanner: {
        image: s.heroBannerImage || '',
        title: { de: s.heroBannerTitle_de || '', en: s.heroBannerTitle_en || '', ar: s.heroBannerTitle_ar || '' },
        subtitle: { de: s.heroBannerSubtitle_de || '', en: s.heroBannerSubtitle_en || '', ar: s.heroBannerSubtitle_ar || '' },
        cta: { de: s.heroBannerCta_de || '', en: s.heroBannerCta_en || '', ar: s.heroBannerCta_ar || '' },
        ctaLink: s.heroBannerCtaLink || '/products',
      },
      social: {
        instagram: s.instagramUrl || '',
        facebook: s.facebookUrl || '',
        tiktok: s.tiktokUrl || '',
      },
      legal: {
        impressum: { de: s.impressum_de || '', en: s.impressum_en || '', ar: s.impressum_ar || '' },
        agb: { de: s.agb_de || '', en: s.agb_en || '', ar: s.agb_ar || '' },
        datenschutz: { de: s.datenschutz_de || '', en: s.datenschutz_en || '', ar: s.datenschutz_ar || '' },
        widerruf: { de: s.widerruf_de || '', en: s.widerruf_en || '', ar: s.widerruf_ar || '' },
      },
      contact: {
        email: s.contactEmail || s.companyEmail || '',
        phone: s.contactPhone || s.companyPhone || '',
        address: s.contactAddress || s.companyAddress || '',
        hours: s.contactHours || '',
      },
      stripeEnabled: true,
      klarnaEnabled: s.klarnaEnabled === 'true',
      paypalEnabled: s.paypalEnabled === 'true',
      welcomePopupEnabled: s.welcomePopupEnabled !== 'false', // default: true
      welcomeDiscountPercent: Number(s.welcomeDiscountPercent || '10'),
      // Pixels & Channels
      meta_pixel_id: s.meta_pixel_id || '',
      tiktok_pixel_id: s.tiktok_pixel_id || '',
      whatsapp_number: s.whatsapp_number || '',
      whatsapp_enabled: s.whatsapp_enabled || 'false',
      whatsapp_message_de: s.whatsapp_message_de || '',
      whatsapp_message_ar: s.whatsapp_message_ar || '',
      // AI
      ai_global_enabled: s.ai_global_enabled || 'false',
      ai_customer_chat_enabled: s.ai_customer_chat_enabled || 'false',
      maintenance_enabled: s.maintenance_enabled || 'false',
      // PostHog Analytics
      posthog_enabled: s.posthog_enabled || 'false',
      posthog_key: s.posthog_key || '',
      posthog_host: s.posthog_host || 'https://eu.i.posthog.com',
      // Cookie Consent
      cookie_banner_enabled: s.cookie_banner_enabled !== 'false' ? 'true' : 'false',
      // Returns
      returnsEnabled: s.returnsEnabled !== 'false' ? 'true' : 'false',
    }
  }
}

// Guest order lookup — no auth, requires orderNumber + email
@ApiTags('Orders')
@Controller('orders')
export class GuestOrderController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('guest')
  @ApiOperation({ summary: 'Guest order lookup by orderNumber + email' })
  @ApiQuery({ name: 'orderNumber', required: true })
  @ApiQuery({ name: 'email', required: true })
  async guestLookup(@Query('orderNumber') orderNumber: string, @Query('email') email: string) {
    if (!orderNumber || !email) return { error: 'orderNumber and email required' }

    const order = await this.prisma.order.findFirst({
      where: {
        orderNumber,
        OR: [
          { guestEmail: { equals: email, mode: 'insensitive' } },
          { user: { email: { equals: email, mode: 'insensitive' } } },
        ],
        deletedAt: null,
      },
      include: {
        items: {
          select: {
            snapshotName: true, snapshotSku: true, quantity: true, unitPrice: true, totalPrice: true,
            variant: { select: { color: true, size: true, product: { select: { images: { select: { url: true }, take: 1 } } } } },
          },
        },
        shippingAddress: { select: { firstName: true, lastName: true, street: true, houseNumber: true, postalCode: true, city: true, country: true } },
        shipment: { select: { status: true, trackingNumber: true, trackingUrl: true, carrier: true, shippedAt: true, deliveredAt: true, estimatedDelivery: true } },
        payment: { select: { method: true, status: true } },
      },
    })

    if (!order) return { error: 'not_found' }

    return {
      orderNumber: order.orderNumber,
      status: order.status,
      createdAt: order.createdAt,
      subtotal: order.subtotal,
      shippingCost: order.shippingCost,
      taxAmount: order.taxAmount,
      totalAmount: order.totalAmount,
      items: order.items,
      shippingAddress: order.shippingAddress,
      shipment: order.shipment,
      payment: order.payment,
    }
  }

  @Get('confirmation')
  @ApiOperation({ summary: 'One-time order confirmation by token' })
  @ApiQuery({ name: 'token', required: true })
  async confirmationLookup(@Query('token') token: string) {
    if (!token) return { error: 'token_required' }

    // Find order with this confirmation token in notes
    const orders = await this.prisma.order.findMany({
      where: { deletedAt: null },
      select: { id: true, notes: true, orderNumber: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    const match = orders.find((o) => {
      try { return JSON.parse(o.notes ?? '{}').confirmationToken === token }
      catch { return false }
    })

    if (!match) return { error: 'invalid_token' }

    // Get full order data
    const order = await this.prisma.order.findUnique({
      where: { id: match.id },
      include: {
        items: {
          select: {
            id: true, snapshotName: true, snapshotSku: true, quantity: true, unitPrice: true, totalPrice: true,
            variant: { select: { color: true, size: true, product: { select: { images: { select: { url: true }, take: 1 } } } } },
          },
        },
        shippingAddress: { select: { firstName: true, lastName: true, street: true, houseNumber: true, postalCode: true, city: true, country: true } },
        payment: { select: { method: true, status: true } },
        user: { select: { email: true } },
      },
    })

    if (!order) return { error: 'not_found' }

    // Consume token — remove from notes so it can't be used again
    try {
      const notes = JSON.parse(order.notes ?? '{}')
      delete notes.confirmationToken
      await this.prisma.order.update({
        where: { id: order.id },
        data: { notes: JSON.stringify(notes) },
      })
    } catch {}

    return {
      orderNumber: order.orderNumber,
      status: order.status,
      createdAt: order.createdAt,
      subtotal: order.subtotal,
      shippingCost: order.shippingCost,
      taxAmount: order.taxAmount,
      totalAmount: order.totalAmount,
      guestEmail: order.guestEmail,
      email: order.user?.email ?? order.guestEmail,
      items: order.items,
      shippingAddress: order.shippingAddress,
      payment: order.payment,
    }
  }
}

// Public shipping zones — no auth, filtered by country
@ApiTags('Shipping')
@Controller('shipping-zones')
export class PublicShippingZonesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Get shipping zones for a country (public)' })
  @ApiQuery({ name: 'country', required: false })
  async getZones(@Query('country') country?: string) {
    const zones = await this.prisma.shippingZone.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { basePrice: 'asc' },
    })

    if (country) {
      const c = country.toUpperCase()
      return zones.filter((z) => z.countryCodes.includes(c))
    }
    return zones
  }
}

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'System Health Check' })
  async check() {
    const checks = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        database: 'unknown',
        api: 'ok',
      },
    }

    try {
      await this.prisma.$queryRaw`SELECT 1`
      checks.services.database = 'ok'
    } catch {
      checks.services.database = 'error'
      checks.status = 'degraded'
    }

    return checks
  }
}
