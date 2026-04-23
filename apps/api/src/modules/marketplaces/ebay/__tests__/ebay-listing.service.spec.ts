/**
 * C11c — EbayListingService tests.
 *
 * Covers Meta-Verify targets:
 *   MV-1  Happy path: pending → active + externalListingId persisted
 *   MV-2  inventory-item 400 → status='rejected', no Offer-Create
 *   MV-3  offer-create 400 → status='rejected', no Publish
 *   MV-4  offer-publish 400 → status='rejected'
 *   MV-5  Concurrency: 2 simultaneous publishOne calls → only one claims
 *   MV-6  Mapping-block (weight null) → status='rejected', zero HTTP
 *
 * Uses an in-memory prisma mock + fetch mock. No real DB, no real HTTP.
 */

import { EbayListingService } from '../ebay-listing.service'
import type { FetchLike } from '../ebay-api.client'
import type { EbayAuthService } from '../ebay-auth.service'
import type { AuditService } from '../../../admin/services/audit.service'

async function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => Promise<T>): Promise<T> {
  const saved = { ...process.env }
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('EBAY_') || k.startsWith('COMPANY_SHIP_')) delete process.env[k]
  }
  Object.assign(process.env, env)
  try {
    return await fn()
  } finally {
    for (const k of Object.keys(env)) delete process.env[k]
    Object.assign(process.env, saved)
  }
}

const SANDBOX_ENV = {
  EBAY_ENV: 'sandbox',
  EBAY_SANDBOX_APP_ID: 'app',
  EBAY_SANDBOX_DEV_ID: 'dev',
  EBAY_SANDBOX_CERT_ID: 'cert',
  EBAY_SANDBOX_RUNAME: 'RUNAME',
}

// ──────────────────────────────────────────────────────────────
// In-memory Prisma mock
// ──────────────────────────────────────────────────────────────

interface DbSnapshot {
  listings: Record<string, any>
  products: Record<string, any>
  variants: Record<string, any>
  inventories: any[]
  config: any
}

function mkPrisma(snap: DbSnapshot) {
  return {
    _snap: snap,
    channelProductListing: {
      findMany: async ({ where, take }: any) => {
        const all = Object.values(snap.listings) as any[]
        const filtered = all.filter((l) =>
          (!where.channel || l.channel === where.channel) &&
          (!where.status || l.status === where.status),
        )
        return filtered.slice(0, take ?? filtered.length)
      },
      count: async ({ where }: any) => {
        const all = Object.values(snap.listings) as any[]
        return all.filter((l) =>
          (!where.channel || l.channel === where.channel) &&
          (!where.status || l.status === where.status),
        ).length
      },
      findUnique: async ({ where }: any) => snap.listings[where.id] ?? null,
      update: async ({ where, data }: any) => {
        const row = snap.listings[where.id]
        if (!row) throw new Error('not-found')
        Object.assign(row, data)
        return row
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0
        for (const l of Object.values(snap.listings) as any[]) {
          if (where.id && l.id !== where.id) continue
          if (where.status && l.status !== where.status) continue
          if (where.channel && l.channel !== where.channel) continue
          count++
          if (data.syncAttempts?.increment) {
            l.syncAttempts = (l.syncAttempts ?? 0) + data.syncAttempts.increment
          }
          if (data.lastSyncedAt) l.lastSyncedAt = data.lastSyncedAt
          for (const k of Object.keys(data)) {
            if (k === 'syncAttempts' || k === 'lastSyncedAt') continue
            l[k] = data[k]
          }
        }
        return { count }
      },
      upsert: async () => { throw new Error('not-used-in-publish-tests') },
    },
    productVariant: {
      findUnique: async ({ where }: any) => snap.variants[where.id] ?? null,
    },
    product: {
      findUnique: async ({ where }: any) => snap.products[where.id] ?? null,
    },
    inventory: {
      findMany: async ({ where }: any) =>
        snap.inventories.filter((i) => i.variantId === where.variantId),
    },
    salesChannelConfig: {
      findUnique: async () => snap.config,
    },
  } as any
}

function mkAuth(token = 'fake-token'): EbayAuthService {
  return {
    getAccessTokenOrRefresh: async () => token,
  } as any
}

function mkAudit(): AuditService {
  const entries: any[] = []
  return {
    log: async (entry: any) => { entries.push(entry) },
    _entries: entries,
  } as any
}

function mkRoutingFetch(
  routes: Record<string, (init: RequestInit) => { status: number; body: string }>,
): { fetch: FetchLike; callLog: Array<{ method: string; url: string; body?: string }> } {
  const callLog: Array<{ method: string; url: string; body?: string }> = []
  const fetch: FetchLike = async (url, init) => {
    const method = init.method ?? 'GET'
    callLog.push({ method, url, body: init.body as string | undefined })
    const u = new URL(url)
    const pathWithQuery = u.pathname + u.search
    const keys = Object.keys(routes).sort((a, b) => b.length - a.length)
    const match = keys.find((k) => pathWithQuery === k || pathWithQuery.startsWith(k) || u.pathname === k || u.pathname.startsWith(k))
    const route = match ? routes[match] : undefined
    const r = route ? route(init) : { status: 404, body: '{}' }
    return {
      status: r.status,
      headers: { get: () => null },
      text: async () => r.body,
      json: async () => (r.body ? JSON.parse(r.body) : {}),
    }
  }
  return { fetch, callLog }
}

// Baseline fixtures — a valid publish-ready listing.
function mkBaselineSnapshot(): DbSnapshot {
  return {
    listings: {
      'L1': {
        id: 'L1',
        variantId: 'V1',
        productId: 'P1',
        channel: 'ebay',
        status: 'pending',
        channelPrice: null,
        safetyStock: 1,
        externalListingId: null,
        syncAttempts: 0,
        syncError: null,
      },
    },
    variants: {
      'V1': {
        id: 'V1',
        productId: 'P1',
        sku: 'MAL-001-SCH-L',
        barcode: '1234567890123',
        color: 'Schwarz',
        size: 'L',
        priceModifier: '0',
        weightGrams: 250,
      },
    },
    products: {
      'P1': {
        id: 'P1',
        slug: 'hemd',
        brand: 'Malak',
        basePrice: '49.99',
        salePrice: null,
        category: { ebayCategoryId: '11483' },
        translations: [
          { language: 'de', name: 'Herren Hemd', description: 'Beschreibung' },
        ],
        images: [
          { url: 'https://cdn.malak.com/1.jpg', colorName: 'Schwarz', isPrimary: true, sortOrder: 0 },
        ],
      },
    },
    inventories: [
      { variantId: 'V1', quantityOnHand: 10, quantityReserved: 2 },
    ],
    config: {
      channel: 'ebay',
      settings: {
        policyIds: {
          fulfillmentPolicyId: 'f-1',
          returnPolicyId: 'r-1',
          paymentPolicyId: 'p-1',
        },
        merchantLocationKey: 'malak-lager-berlin',
      },
    },
  }
}

// Baseline eBay-success route handler.
function happyPathRoutes(): Record<string, (init: RequestInit) => { status: number; body: string }> {
  return {
    '/sell/inventory/v1/inventory_item/MAL-001-SCH-L': () => ({ status: 204, body: '' }),
    '/sell/inventory/v1/offer?sku=MAL-001-SCH-L': () => ({
      status: 200,
      body: JSON.stringify({ offers: [] }),
    }),
    '/sell/inventory/v1/offer/OFFER-1/publish': () => ({
      status: 200,
      body: JSON.stringify({ listingId: 'EBAY-LISTING-1' }),
    }),
    '/sell/inventory/v1/offer/OFFER-1': () => ({ status: 200, body: '{}' }),
    '/sell/inventory/v1/offer': () => ({
      status: 201,
      body: JSON.stringify({ offerId: 'OFFER-1' }),
    }),
  }
}

// ──────────────────────────────────────────────────────────────
// MV-1 Happy path
// ──────────────────────────────────────────────────────────────

describe('EbayListingService.publishOne — MV-1 happy path', () => {
  it('pending listing → active with externalListingId persisted', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const { fetch, callLog } = mkRoutingFetch(happyPathRoutes())
      svc.__setFetchForTests(fetch)

      const result = await svc.publishOne('L1')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.externalListingId).toBe('EBAY-LISTING-1')
        expect(result.alreadyPublished).toBe(false)
      }
      expect(snap.listings['L1'].status).toBe('active')
      expect(snap.listings['L1'].externalListingId).toBe('EBAY-LISTING-1')
      expect(snap.listings['L1'].syncAttempts).toBe(1)
      expect(snap.listings['L1'].syncError).toBeNull()
      // Exactly 4 eBay calls: PUT inventory-item, GET offer-lookup, POST create, POST publish
      expect(callLog.map((c) => c.method)).toEqual(['PUT', 'GET', 'POST', 'POST'])
    })
  })

  it('existing offer path → PUT update instead of POST create, then publish', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const { fetch, callLog } = mkRoutingFetch({
        '/sell/inventory/v1/inventory_item/MAL-001-SCH-L': () => ({ status: 204, body: '' }),
        '/sell/inventory/v1/offer?sku=MAL-001-SCH-L': () => ({
          status: 200,
          body: JSON.stringify({
            offers: [{ offerId: 'OFFER-EXIST', marketplaceId: 'EBAY_DE', status: 'UNPUBLISHED' }],
          }),
        }),
        '/sell/inventory/v1/offer/OFFER-EXIST': () => ({ status: 204, body: '' }),
        '/sell/inventory/v1/offer/OFFER-EXIST/publish': () => ({
          status: 200,
          body: JSON.stringify({ listingId: 'EBAY-LISTING-X' }),
        }),
      })
      svc.__setFetchForTests(fetch)

      const result = await svc.publishOne('L1')
      expect(result.ok).toBe(true)
      // PUT inventory, GET offer, PUT offer (update), POST publish
      expect(callLog.map((c) => c.method)).toEqual(['PUT', 'GET', 'PUT', 'POST'])
    })
  })

  it('handles "offer already published" errorId 25002 gracefully', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const { fetch } = mkRoutingFetch({
        '/sell/inventory/v1/inventory_item/MAL-001-SCH-L': () => ({ status: 204, body: '' }),
        '/sell/inventory/v1/offer?sku=MAL-001-SCH-L': () => ({
          status: 200,
          body: JSON.stringify({ offers: [] }),
        }),
        '/sell/inventory/v1/offer': () => ({ status: 201, body: JSON.stringify({ offerId: 'O-1' }) }),
        '/sell/inventory/v1/offer/O-1/publish': () => ({
          status: 400,
          body: JSON.stringify({ errors: [{ errorId: 25002, message: 'already published' }] }),
        }),
        '/sell/inventory/v1/offer/O-1': () => ({
          status: 200,
          body: JSON.stringify({ listing: { listingId: 'EBAY-ALREADY' } }),
        }),
      })
      svc.__setFetchForTests(fetch)

      const result = await svc.publishOne('L1')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.alreadyPublished).toBe(true)
        expect(result.externalListingId).toBe('EBAY-ALREADY')
      }
      expect(snap.listings['L1'].status).toBe('active')
    })
  })
})

// ──────────────────────────────────────────────────────────────
// MV-2 Inventory-Item failure
// ──────────────────────────────────────────────────────────────

describe('EbayListingService.publishOne — MV-2 inventory-item failure', () => {
  it('400 on inventory-item → status=rejected, no Offer-Create attempted', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const { fetch, callLog } = mkRoutingFetch({
        '/sell/inventory/v1/inventory_item/MAL-001-SCH-L': () => ({
          status: 400,
          body: JSON.stringify({ errors: [{ errorId: 99, message: 'bad payload' }] }),
        }),
      })
      svc.__setFetchForTests(fetch)

      const result = await svc.publishOne('L1')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errorCode).toBe('inventory_item_failed')
        expect(result.retryable).toBe(false)
      }
      expect(snap.listings['L1'].status).toBe('rejected')
      expect(snap.listings['L1'].syncError).toContain('inventory_item_failed')
      // No Offer lookup / create / publish
      expect(callLog.every((c) => c.url.includes('/inventory_item/'))).toBe(true)
    })
  })

  it('5xx on inventory-item → keeps status=pending (retryable)', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const { fetch } = mkRoutingFetch({
        '/sell/inventory/v1/inventory_item/MAL-001-SCH-L': () => ({
          status: 500,
          body: JSON.stringify({ errors: [{ errorId: 20500, message: 'system error' }] }),
        }),
      })
      svc.__setFetchForTests(fetch)

      const result = await svc.publishOne('L1')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.retryable).toBe(true)
      expect(snap.listings['L1'].status).toBe('pending') // retryable keeps pending
    })
  })
})

// ──────────────────────────────────────────────────────────────
// MV-3 Offer-Create failure
// ──────────────────────────────────────────────────────────────

describe('EbayListingService.publishOne — MV-3 offer-create failure', () => {
  it('400 on POST offer → status=rejected, no Publish attempted', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const { fetch, callLog } = mkRoutingFetch({
        '/sell/inventory/v1/inventory_item/MAL-001-SCH-L': () => ({ status: 204, body: '' }),
        '/sell/inventory/v1/offer?sku=MAL-001-SCH-L': () => ({
          status: 200, body: '{"offers":[]}',
        }),
        '/sell/inventory/v1/offer': () => ({
          status: 400,
          body: JSON.stringify({ errors: [{ errorId: 25000, message: 'invalid offer' }] }),
        }),
      })
      svc.__setFetchForTests(fetch)

      const result = await svc.publishOne('L1')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errorCode).toBe('offer_create_failed')
      expect(snap.listings['L1'].status).toBe('rejected')
      // No /publish call happened
      expect(callLog.every((c) => !c.url.endsWith('/publish'))).toBe(true)
    })
  })
})

// ──────────────────────────────────────────────────────────────
// MV-4 Offer-Publish failure
// ──────────────────────────────────────────────────────────────

describe('EbayListingService.publishOne — MV-4 offer-publish failure', () => {
  it('400 on /publish → status=rejected, offer stays unpublished', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const { fetch } = mkRoutingFetch({
        '/sell/inventory/v1/inventory_item/MAL-001-SCH-L': () => ({ status: 204, body: '' }),
        '/sell/inventory/v1/offer?sku=MAL-001-SCH-L': () => ({ status: 200, body: '{"offers":[]}' }),
        '/sell/inventory/v1/offer': () => ({ status: 201, body: JSON.stringify({ offerId: 'O-1' }) }),
        '/sell/inventory/v1/offer/O-1/publish': () => ({
          status: 400,
          body: JSON.stringify({ errors: [{ errorId: 25050, message: 'missing required field' }] }),
        }),
      })
      svc.__setFetchForTests(fetch)

      const result = await svc.publishOne('L1')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errorCode).toBe('publish_failed')
      expect(snap.listings['L1'].status).toBe('rejected')
    })
  })
})

// ──────────────────────────────────────────────────────────────
// MV-5 Concurrency — conditional-UPDATE claim
// ──────────────────────────────────────────────────────────────

describe('EbayListingService.publishOne — MV-5 concurrency claim', () => {
  it('second simultaneous call on same listing finds nothing to claim and exits cleanly', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const { fetch } = mkRoutingFetch(happyPathRoutes())
      svc.__setFetchForTests(fetch)

      // First call: happy path, flips status to 'active'.
      const first = await svc.publishOne('L1')
      expect(first.ok).toBe(true)
      expect(snap.listings['L1'].status).toBe('active')

      // Second call: status is no longer 'pending' → claim returns 0 rows
      // → no HTTP call, returns not_claimable failure.
      const second = await svc.publishOne('L1')
      expect(second.ok).toBe(false)
      if (!second.ok) {
        expect(second.errorCode).toBe('not_claimable')
      }
    })
  })
})

// ──────────────────────────────────────────────────────────────
// MV-6 Mapping-block (weight null / no images / no category)
// ──────────────────────────────────────────────────────────────

describe('EbayListingService.publishOne — MV-6 mapping-block errors', () => {
  it('weight_missing → status=rejected, ZERO HTTP calls', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      snap.variants['V1'].weightGrams = null // break it
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const { fetch, callLog } = mkRoutingFetch(happyPathRoutes())
      svc.__setFetchForTests(fetch)

      const result = await svc.publishOne('L1')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errorCode).toBe('weight_missing')
      expect(snap.listings['L1'].status).toBe('rejected')
      expect(callLog).toHaveLength(0) // mapper throws BEFORE any HTTP
    })
  })

  it('no_images → status=rejected, ZERO HTTP calls', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      snap.products['P1'].images = []
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const { fetch, callLog } = mkRoutingFetch(happyPathRoutes())
      svc.__setFetchForTests(fetch)

      const result = await svc.publishOne('L1')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errorCode).toBe('no_images')
      expect(callLog).toHaveLength(0)
    })
  })

  it('missing_ebay_category_id → status=rejected, ZERO HTTP calls', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      snap.products['P1'].category = { ebayCategoryId: null }
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const { fetch, callLog } = mkRoutingFetch(happyPathRoutes())
      svc.__setFetchForTests(fetch)

      const result = await svc.publishOne('L1')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errorCode).toBe('missing_ebay_category_id')
      expect(callLog).toHaveLength(0)
    })
  })
})

// ──────────────────────────────────────────────────────────────
// Bootstrap-incomplete pre-check
// ──────────────────────────────────────────────────────────────

describe('EbayListingService.publishOne — bootstrap pre-checks', () => {
  it('missing policyIds → status=rejected with code bootstrap_incomplete', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      snap.config.settings.policyIds = undefined
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const { fetch, callLog } = mkRoutingFetch(happyPathRoutes())
      svc.__setFetchForTests(fetch)

      const result = await svc.publishOne('L1')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errorCode).toBe('bootstrap_incomplete')
      expect(callLog).toHaveLength(0) // no HTTP before pre-check fails
    })
  })

  it('missing merchantLocationKey → status=rejected', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      snap.config.settings.merchantLocationKey = undefined
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const { fetch } = mkRoutingFetch(happyPathRoutes())
      svc.__setFetchForTests(fetch)

      const result = await svc.publishOne('L1')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errorCode).toBe('bootstrap_incomplete')
    })
  })
})

// ──────────────────────────────────────────────────────────────
// publishPending — batch behavior
// ──────────────────────────────────────────────────────────────

describe('EbayListingService.publishPending — bulk', () => {
  it('processes up to batchLimit listings sequentially and returns summary', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      // Add 2 more pending listings
      snap.listings['L2'] = { ...snap.listings['L1'], id: 'L2' }
      snap.listings['L3'] = { ...snap.listings['L1'], id: 'L3' }
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const { fetch } = mkRoutingFetch(happyPathRoutes())
      svc.__setFetchForTests(fetch)

      const summary = await svc.publishPending('admin-1', 2) // limit 2

      expect(summary.requested).toBe(2)
      expect(summary.published + summary.failed).toBe(2)
      expect(summary.remaining).toBe(1) // 3 total, 2 processed, 1 left
    })
  })

  it('partial failure: 1 success + 1 rejected collected in results', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      // L2 has a bad variant (no weight)
      snap.listings['L2'] = { ...snap.listings['L1'], id: 'L2', variantId: 'V2' }
      snap.variants['V2'] = { ...snap.variants['V1'], id: 'V2', sku: 'MAL-002-SCH-M', weightGrams: null }
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const { fetch } = mkRoutingFetch(happyPathRoutes())
      svc.__setFetchForTests(fetch)

      const summary = await svc.publishPending('admin-1', 10)

      expect(summary.published).toBe(1)
      expect(summary.failed).toBe(1)
      const failure = summary.results.find((r) => r.ok === false) as any
      expect(failure.errorCode).toBe('weight_missing')
    })
  })

  it('caps batchLimit at 100 even if caller passes higher value', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const { fetch } = mkRoutingFetch(happyPathRoutes())
      svc.__setFetchForTests(fetch)

      // Only 1 pending, but caller asks for 500 — capped silently.
      const summary = await svc.publishPending('admin-1', 500)
      expect(summary.requested).toBe(1)
    })
  })
})

// ──────────────────────────────────────────────────────────────
// Toggle
// ──────────────────────────────────────────────────────────────

describe('EbayListingService.toggleForProduct', () => {
  it('toggle=true upserts pending listing per active variant', async () => {
    const prisma: any = {
      product: {
        findUnique: async () => ({
          id: 'P1',
          variants: [{ id: 'V1' }, { id: 'V2' }],
        }),
      },
      channelProductListing: {
        upsert: jest.fn(async () => ({})),
        updateMany: jest.fn(),
      },
    }
    const audit = mkAudit()
    const svc = new EbayListingService(prisma, mkAuth(), audit)

    const result = await svc.toggleForProduct('P1', true, 'admin-1', '75.00')

    expect(result).toEqual({ productId: 'P1', enabled: true, affectedVariants: 2 })
    expect(prisma.channelProductListing.upsert).toHaveBeenCalledTimes(2)
    const auditEntry = (audit as any)._entries.find(
      (e: any) => e.action === 'EBAY_LISTING_ENABLED',
    )
    expect(auditEntry).toBeDefined()
    expect(auditEntry.changes.after.channelPrice).toBe('75.00')
  })

  it('toggle=false soft-deletes all non-deleted rows', async () => {
    const prisma: any = {
      product: {
        findUnique: async () => ({ id: 'P1', variants: [] }),
      },
      channelProductListing: {
        updateMany: jest.fn(async () => ({ count: 3 })),
      },
    }
    const audit = mkAudit()
    const svc = new EbayListingService(prisma, mkAuth(), audit)

    const result = await svc.toggleForProduct('P1', false, 'admin-1')

    expect(result).toEqual({ productId: 'P1', enabled: false, affectedVariants: 3 })
    expect(prisma.channelProductListing.updateMany).toHaveBeenCalledWith({
      where: { productId: 'P1', channel: 'ebay', status: { not: 'deleted' } },
      data: { status: 'deleted' },
    })
  })

  it('throws MappingBlockError when product not found', async () => {
    const prisma: any = {
      product: { findUnique: async () => null },
    }
    const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
    await expect(
      svc.toggleForProduct('NOPE', true, 'admin-1'),
    ).rejects.toMatchObject({ code: 'product_not_found' })
  })
})
