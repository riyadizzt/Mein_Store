/**
 * Feed reader-cut integration tests (C6).
 *
 * Byte-equal guard (feeds-byte-equal.spec.ts) locks that the new
 * reader produces the same output as the old one. THIS file tests
 * the new-reader-specific behaviour:
 *
 *   - pending-status listings ARE served (user Q2c)
 *   - paused/deleted/rejected listings are NOT served
 *   - per-channel feed tokens (user P8, Q4b): each channel has its
 *     own token, they don't cross-authenticate
 *   - Google dynamic shipping block uses the active shipping zones
 *   - Google taxonomy ID preferred over category name when set
 *   - UTM helper returns exact strings locked to pre-C6 byte equality
 */

import { FeedsService } from '../feeds.service'
import { channelUtmParams } from '../../../common/helpers/channel-utm'

type AnyObj = Record<string, any>

function buildMockPrisma(opts: {
  products?: AnyObj[]
  listings?: AnyObj[]
  shippingZones?: AnyObj[]
  tokens?: Record<string, string>
}) {
  const tokenStore = new Map<string, string>(Object.entries(opts.tokens ?? {}))
  return {
    shopSetting: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), upsert: jest.fn() },
    shippingZone: {
      findMany: jest.fn(async () => opts.shippingZones ?? [
        { zoneName: 'DE', countryCodes: ['DE'], basePrice: 4.99, isActive: true, deletedAt: null },
      ]),
    },
    salesChannelConfig: {
      findUnique: jest.fn(async ({ where }: any) => {
        const t = tokenStore.get(where.channel)
        return t ? { feedToken: t } : null
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const merged = { ...(tokenStore.get(where.channel) ? { feedToken: tokenStore.get(where.channel) } : {}), ...update }
        if (merged.feedToken) tokenStore.set(where.channel, merged.feedToken)
        else if (create?.feedToken) tokenStore.set(where.channel, create.feedToken)
        return create
      }),
    },
    product: {
      findMany: jest.fn(async ({ where }: any) => {
        const products = opts.products ?? []
        return products.filter((p) => {
          if (where.isActive === true && !p.isActive) return false
          if (where.deletedAt === null && p.deletedAt !== null) return false
          if (where.channelListings?.some) {
            const { channel, status } = where.channelListings.some
            const allowed: string[] = status?.in ?? ['active', 'pending']
            // Match against the test's explicit listings list
            const listings = opts.listings ?? []
            const hit = listings.find((l) =>
              l.productId === p.id && l.channel === channel && allowed.includes(l.status),
            )
            if (!hit) return false
          }
          return true
        })
      }),
    },
  }
}

function mkProduct(id: string, overrides: Partial<AnyObj> = {}): AnyObj {
  return {
    id, slug: `p-${id}`, isActive: true, deletedAt: null,
    basePrice: 49.99, salePrice: null, brand: 'Malak',
    translations: [{ language: 'de', name: `Produkt ${id}`, description: 'Testbeschreibung' }],
    variants: [{
      id: `v-${id}`, sku: `SKU-${id}`, color: 'Blau', size: 'M',
      priceModifier: 0, isActive: true,
      inventory: [{ quantityOnHand: 5, quantityReserved: 0 }],
    }],
    images: [{ url: `https://cdn.test/${id}.jpg`, sortOrder: 0 }],
    category: { id: `c-${id}`, translations: [{ language: 'de', name: 'Hemden' }] },
    ...overrides,
  }
}

describe('FeedsService — listing-status-aware reader (C6 Q2c)', () => {
  it('includes products with listings.status="active"', async () => {
    const prisma = buildMockPrisma({
      products: [mkProduct('p1')],
      listings: [{ productId: 'p1', channel: 'facebook', status: 'active' }],
    })
    const feeds = new FeedsService(prisma as any)
    const { stats } = await feeds.getFacebookFeed('de', true)
    expect(stats.exported).toBeGreaterThan(0)
  })

  it('includes products with listings.status="pending" (C6 Q2c — newly created)', async () => {
    const prisma = buildMockPrisma({
      products: [mkProduct('p1')],
      listings: [{ productId: 'p1', channel: 'facebook', status: 'pending' }],
    })
    const feeds = new FeedsService(prisma as any)
    const { stats } = await feeds.getFacebookFeed('de', true)
    expect(stats.exported).toBeGreaterThan(0)
  })

  it('EXCLUDES products with listings.status="paused"', async () => {
    const prisma = buildMockPrisma({
      products: [mkProduct('p1')],
      listings: [{ productId: 'p1', channel: 'facebook', status: 'paused' }],
    })
    const feeds = new FeedsService(prisma as any)
    const { stats } = await feeds.getFacebookFeed('de', true)
    expect(stats.exported).toBe(0)
    expect(stats.total).toBe(0)
  })

  it('EXCLUDES products with listings.status="deleted" (soft-delete)', async () => {
    const prisma = buildMockPrisma({
      products: [mkProduct('p1')],
      listings: [{ productId: 'p1', channel: 'facebook', status: 'deleted' }],
    })
    const feeds = new FeedsService(prisma as any)
    const { stats } = await feeds.getFacebookFeed('de', true)
    expect(stats.exported).toBe(0)
  })

  it('EXCLUDES products with listings.status="rejected"', async () => {
    const prisma = buildMockPrisma({
      products: [mkProduct('p1')],
      listings: [{ productId: 'p1', channel: 'facebook', status: 'rejected' }],
    })
    const feeds = new FeedsService(prisma as any)
    const { stats } = await feeds.getFacebookFeed('de', true)
    expect(stats.exported).toBe(0)
  })

  it('channel isolation: p with facebook-listing only appears in FB feed, not google', async () => {
    const prisma = buildMockPrisma({
      products: [mkProduct('p1')],
      listings: [{ productId: 'p1', channel: 'facebook', status: 'active' }],
    })
    const feeds = new FeedsService(prisma as any)
    const fb = await feeds.getFacebookFeed('de', true)
    const gg = await feeds.getGoogleFeed('de', true)
    expect(fb.stats.exported).toBeGreaterThan(0)
    expect(gg.stats.exported).toBe(0)
  })
})

describe('FeedsService — per-channel feed tokens (C6 P8)', () => {
  it('a facebook token does NOT authenticate the google feed', async () => {
    const prisma = buildMockPrisma({
      tokens: { facebook: 'FB_TOKEN', google: 'GG_TOKEN' },
    })
    const feeds = new FeedsService(prisma as any)
    expect(await feeds.validateTokenForChannel('facebook', 'FB_TOKEN')).toBe(true)
    expect(await feeds.validateTokenForChannel('google', 'FB_TOKEN')).toBe(false)
    expect(await feeds.validateTokenForChannel('facebook', 'GG_TOKEN')).toBe(false)
  })

  it('rotating one channel token does not affect the other 3', async () => {
    const prisma = buildMockPrisma({
      tokens: { facebook: 'OLD_FB', tiktok: 'TT', google: 'GG', whatsapp: 'WA' },
    })
    const feeds = new FeedsService(prisma as any)
    const newFb = await feeds.regenerateTokenForChannel('facebook')
    expect(newFb).not.toBe('OLD_FB')
    expect(await feeds.validateTokenForChannel('facebook', 'OLD_FB')).toBe(false)
    expect(await feeds.validateTokenForChannel('facebook', newFb)).toBe(true)
    expect(await feeds.validateTokenForChannel('tiktok', 'TT')).toBe(true)
    expect(await feeds.validateTokenForChannel('google', 'GG')).toBe(true)
    expect(await feeds.validateTokenForChannel('whatsapp', 'WA')).toBe(true)
  })

  it('validateTokenForChannel rejects an unset channel (no legacy fallback)', async () => {
    const prisma = buildMockPrisma({ tokens: {} })
    const feeds = new FeedsService(prisma as any)
    expect(await feeds.validateTokenForChannel('facebook', 'ANYTHING')).toBe(false)
  })

  it('getFeedTokenForChannel lazy-generates on first access', async () => {
    const prisma = buildMockPrisma({ tokens: {} })
    const feeds = new FeedsService(prisma as any)
    const t1 = await feeds.getFeedTokenForChannel('facebook')
    const t2 = await feeds.getFeedTokenForChannel('facebook')
    expect(t1).toBe(t2) // idempotent
    expect(t1).toMatch(/^[a-z0-9]{32}$/)
    expect(await feeds.validateTokenForChannel('facebook', t1)).toBe(true)
  })
})

describe('Google feed — dynamic shipping zones (C6)', () => {
  it('emits one shipping block per (zone × countryCode)', async () => {
    const prisma = buildMockPrisma({
      products: [mkProduct('p1')],
      listings: [{ productId: 'p1', channel: 'google', status: 'active' }],
      shippingZones: [
        { zoneName: 'DE', countryCodes: ['DE'], basePrice: 4.99, isActive: true, deletedAt: null },
        { zoneName: 'EU', countryCodes: ['FR', 'NL', 'BE'], basePrice: 9.99, isActive: true, deletedAt: null },
      ],
    })
    const feeds = new FeedsService(prisma as any)
    const { xml } = await feeds.getGoogleFeed('de', true)
    // 4 countryCodes across 2 zones → 4 shipping blocks per item
    expect(xml.match(/<g:shipping>/g)?.length).toBe(4)
    // DE at 4.99
    expect(xml).toContain('<g:country>DE</g:country>')
    expect(xml).toContain('<g:price>4.99 EUR</g:price>')
    // FR/NL/BE at 9.99
    expect(xml).toContain('<g:country>FR</g:country>')
    expect(xml).toContain('<g:country>NL</g:country>')
    expect(xml).toContain('<g:country>BE</g:country>')
    expect(xml).toContain('<g:price>9.99 EUR</g:price>')
  })

  it('renders NO shipping block when no active zones exist (launch-defensive)', async () => {
    const prisma = buildMockPrisma({
      products: [mkProduct('p1')],
      listings: [{ productId: 'p1', channel: 'google', status: 'active' }],
      shippingZones: [],
    })
    const feeds = new FeedsService(prisma as any)
    const { xml } = await feeds.getGoogleFeed('de', true)
    expect(xml).not.toContain('<g:shipping>')
  })
})

describe('Google feed — taxonomy ID preferred over category name (C6)', () => {
  it('emits <g:google_product_category>{id}</> when googleCategoryId is set', async () => {
    const prod = mkProduct('p1', {
      category: {
        id: 'c1',
        googleCategoryId: '1604', // Apparel & Accessories > Clothing > Shirts
        translations: [{ language: 'de', name: 'Hemden' }],
      },
    })
    const prisma = buildMockPrisma({
      products: [prod],
      listings: [{ productId: 'p1', channel: 'google', status: 'active' }],
    })
    const feeds = new FeedsService(prisma as any)
    const { xml } = await feeds.getGoogleFeed('de', true)
    expect(xml).toContain('<g:google_product_category>1604</g:google_product_category>')
  })

  it('falls back to category name when googleCategoryId is null', async () => {
    const prod = mkProduct('p1', {
      category: { id: 'c1', googleCategoryId: null, translations: [{ language: 'de', name: 'Hemden' }] },
    })
    const prisma = buildMockPrisma({
      products: [prod],
      listings: [{ productId: 'p1', channel: 'google', status: 'active' }],
    })
    const feeds = new FeedsService(prisma as any)
    const { xml } = await feeds.getGoogleFeed('de', true)
    expect(xml).toContain('<g:google_product_category>Hemden</g:google_product_category>')
  })
})

describe('channelUtmParams — pre-C6 strings locked', () => {
  // These 4 strings are the byte-equal contract. External Google
  // Analytics / Meta pixel dashboards filter on these — changing
  // them would break live analytics.
  it('facebook', () => {
    expect(channelUtmParams('facebook')).toBe('utm_source=facebook&utm_medium=shop&utm_campaign=catalog')
  })
  it('tiktok', () => {
    expect(channelUtmParams('tiktok')).toBe('utm_source=tiktok&utm_medium=shop&utm_campaign=catalog')
  })
  it('google', () => {
    expect(channelUtmParams('google')).toBe('utm_source=google&utm_medium=shopping&utm_campaign=feed')
  })
  it('whatsapp', () => {
    expect(channelUtmParams('whatsapp')).toBe('utm_source=whatsapp&utm_medium=catalog&utm_campaign=business')
  })
})
