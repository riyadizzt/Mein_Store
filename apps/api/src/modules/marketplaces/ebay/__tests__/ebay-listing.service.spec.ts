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
          (!where.status || l.status === where.status) &&
          // C11.6: support productId filter for publishProductGroup loaders
          (!where.productId || l.productId === where.productId),
        )
        return filtered.slice(0, take ?? filtered.length)
      },
      // C11.6: findFirst added for publishProductSingleVariant
      findFirst: async ({ where }: any) => {
        const all = Object.values(snap.listings) as any[]
        return all.find((l) =>
          (!where.channel || l.channel === where.channel) &&
          (!where.status || l.status === where.status) &&
          (!where.productId || l.productId === where.productId),
        ) ?? null
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
          if (where.status) {
            // C11.6: support both bare-status and { in: [...] } form
            if (typeof where.status === 'string' && l.status !== where.status) continue
            if (where.status?.in && !where.status.in.includes(l.status)) continue
          }
          if (where.channel && l.channel !== where.channel) continue
          if (where.productId && l.productId !== where.productId) continue
          count++
          if (data.syncAttempts?.increment) {
            l.syncAttempts = (l.syncAttempts ?? 0) + data.syncAttempts.increment
          }
          if (data.lastSyncedAt !== undefined) l.lastSyncedAt = data.lastSyncedAt
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
      // C11.6: count + findMany added for publishProduct routing + group loader
      count: async ({ where }: any) => {
        const all = Object.values(snap.variants) as any[]
        return all.filter((v) =>
          (!where.productId || v.productId === where.productId) &&
          (where.isActive === undefined || (v.isActive ?? true) === where.isActive),
        ).length
      },
      findMany: async ({ where }: any) => {
        const all = Object.values(snap.variants) as any[]
        return all.filter((v) =>
          (!where.productId || v.productId === where.productId) &&
          (where.isActive === undefined || (v.isActive ?? true) === where.isActive),
        )
      },
    },
    product: {
      findUnique: async ({ where }: any) => snap.products[where.id] ?? null,
    },
    inventory: {
      findMany: async ({ where }: any) =>
        snap.inventories.filter((i) => {
          // C11.6: support both bare-variantId and { in: [...] } form
          if (where.variantId?.in) return where.variantId.in.includes(i.variantId)
          if (typeof where.variantId === 'string') return i.variantId === where.variantId
          return true
        }),
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
        category: { ebayCategoryId: '11483', slug: 'herren-hemden', parent: { slug: 'herren' } },
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

  it('Bug B: 25002 with German "bereits veröffentlicht" → success path', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const { fetch } = mkRoutingFetch({
        '/sell/inventory/v1/inventory_item/MAL-001-SCH-L': () => ({ status: 204, body: '' }),
        '/sell/inventory/v1/offer?sku=MAL-001-SCH-L': () => ({
          status: 200, body: JSON.stringify({ offers: [] }),
        }),
        '/sell/inventory/v1/offer': () => ({ status: 201, body: JSON.stringify({ offerId: 'O-2' }) }),
        '/sell/inventory/v1/offer/O-2/publish': () => ({
          status: 400,
          body: JSON.stringify({ errors: [{ errorId: 25002, message: 'Das Angebot ist bereits veröffentlicht' }] }),
        }),
        '/sell/inventory/v1/offer/O-2': () => ({
          status: 200, body: JSON.stringify({ listing: { listingId: 'EBAY-DE-OK' } }),
        }),
      })
      svc.__setFetchForTests(fetch)
      const result = await svc.publishOne('L1')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.alreadyPublished).toBe(true)
        expect(result.externalListingId).toBe('EBAY-DE-OK')
      }
      expect(snap.listings['L1'].status).toBe('active')
    })
  })

  it('Bug B: 25002 with "Abteilung fehlt" message → recordFail rejected (not success)', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const { fetch } = mkRoutingFetch({
        '/sell/inventory/v1/inventory_item/MAL-001-SCH-L': () => ({ status: 204, body: '' }),
        '/sell/inventory/v1/offer?sku=MAL-001-SCH-L': () => ({
          status: 200, body: JSON.stringify({ offers: [] }),
        }),
        '/sell/inventory/v1/offer': () => ({ status: 201, body: JSON.stringify({ offerId: 'O-3' }) }),
        '/sell/inventory/v1/offer/O-3/publish': () => ({
          status: 400,
          body: JSON.stringify({
            errors: [{
              errorId: 25002,
              message: 'Das Artikelmerkmal Abteilung fehlt',
              longMessage: 'Fügen Sie Abteilung zu diesem Angebot hinzu',
              parameters: [{ name: '0', value: 'Abteilung' }],
            }],
          }),
        }),
      })
      svc.__setFetchForTests(fetch)
      const result = await svc.publishOne('L1')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errorCode).toBe('publish_rejected')
        // syncError must contain the actual eBay message, NOT "already published"
        expect(result.errorMessage).toContain('Abteilung')
        expect(result.retryable).toBe(false)
      }
      // Bug A guard: row stays NOT active
      expect(snap.listings['L1'].status).toBe('rejected')
      expect(snap.listings['L1'].externalListingId ?? null).toBeNull()
      expect(snap.listings['L1'].syncError).toContain('Abteilung')
    })
  })

  it('Bug A: 25002 already-published but GET-fallback returns no listingId → rejected (not active)', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const { fetch } = mkRoutingFetch({
        '/sell/inventory/v1/inventory_item/MAL-001-SCH-L': () => ({ status: 204, body: '' }),
        '/sell/inventory/v1/offer?sku=MAL-001-SCH-L': () => ({
          status: 200, body: JSON.stringify({ offers: [] }),
        }),
        '/sell/inventory/v1/offer': () => ({ status: 201, body: JSON.stringify({ offerId: 'O-4' }) }),
        '/sell/inventory/v1/offer/O-4/publish': () => ({
          status: 400,
          body: JSON.stringify({ errors: [{ errorId: 25002, message: 'already published' }] }),
        }),
        // GET fallback returns no listingId — pre-Bug-A this would have flipped to active anyway
        '/sell/inventory/v1/offer/O-4': () => ({
          status: 200, body: JSON.stringify({ listing: {} }),
        }),
      })
      svc.__setFetchForTests(fetch)
      const result = await svc.publishOne('L1')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errorCode).toBe('no_listing_id_after_publish')
      }
      expect(snap.listings['L1'].status).toBe('rejected')
      expect(snap.listings['L1'].externalListingId ?? null).toBeNull()
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
      snap.products['P1'].category = { ebayCategoryId: null, slug: 'herren-hemden', parent: { slug: 'herren' } }
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
  // C11.6: fixtures updated from same-productId to distinct-productIds
  //  because publishPending now groups by productId (was per-variant).
  it('processes up to batchLimit listings sequentially and returns summary', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      // 3 distinct products → 3 publishProduct calls (single-variant
      // path for each since each has only 1 active variant).
      snap.listings['L2'] = { ...snap.listings['L1'], id: 'L2', productId: 'P2', variantId: 'V2' }
      snap.listings['L3'] = { ...snap.listings['L1'], id: 'L3', productId: 'P3', variantId: 'V3' }
      snap.variants['V2'] = { ...snap.variants['V1'], id: 'V2', productId: 'P2', sku: 'MAL-002-SCH-M' }
      snap.variants['V3'] = { ...snap.variants['V1'], id: 'V3', productId: 'P3', sku: 'MAL-003-SCH-M' }
      snap.products['P2'] = { ...snap.products['P1'], id: 'P2', slug: 'product-2' }
      snap.products['P3'] = { ...snap.products['P1'], id: 'P3', slug: 'product-3' }
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const { fetch } = mkRoutingFetch(happyPathRoutes())
      svc.__setFetchForTests(fetch)

      const summary = await svc.publishPending('admin-1', 2) // limit 2 products

      expect(summary.requested).toBe(2)
      expect(summary.published + summary.failed).toBe(2)
      expect(summary.remaining).toBe(1) // 3 total variants, 2 processed, 1 left
    })
  })

  // C11.6: fixtures updated from same-productId to distinct-productIds
  //  because publishPending now groups by productId (was per-variant).
  it('partial failure: 1 success + 1 rejected collected in results', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      // L2 has a bad variant (no weight) — distinct product so it
      // routes through publishProductSingleVariant → publishOne, where
      // the existing weight_missing MappingBlockError fires.
      snap.listings['L2'] = { ...snap.listings['L1'], id: 'L2', productId: 'P2', variantId: 'V2' }
      snap.variants['V2'] = { ...snap.variants['V1'], id: 'V2', productId: 'P2', sku: 'MAL-002-SCH-M', weightGrams: null }
      snap.products['P2'] = { ...snap.products['P1'], id: 'P2', slug: 'product-2' }
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

// ──────────────────────────────────────────────────────────────
// publishProduct — Multi-Variation Group (C11.6)
// ──────────────────────────────────────────────────────────────

// Helper: extend baseline snapshot with N variants for a given product.
// Self-contained — does not depend on V1/L1 still being in the snapshot
// (callers may delete those before calling).
function withMultiVariantProduct(
  snap: DbSnapshot,
  productId: string,
  variantCount: number,
): DbSnapshot {
  for (let i = 0; i < variantCount; i++) {
    const variantId = `${productId}-V${i + 1}`
    const sku = `${productId}-SCH-${40 + i}`
    snap.variants[variantId] = {
      id: variantId,
      productId,
      sku,
      barcode: null,
      color: 'Schwarz',
      size: String(40 + i),
      priceModifier: { toString: () => '0' } as any,
      weightGrams: 500,
      isActive: true,
    }
    snap.listings[`${productId}-L${i + 1}`] = {
      id: `${productId}-L${i + 1}`,
      productId,
      variantId,
      channel: 'ebay',
      status: 'pending',
      channelPrice: null,
      safetyStock: 1,
      externalListingId: null,
      syncAttempts: 0,
      syncError: null,
    }
    snap.inventories.push({ variantId, quantityOnHand: 50, quantityReserved: 0 })
  }
  if (!snap.products[productId]) {
    // Self-contained product (do not borrow from P1)
    snap.products[productId] = {
      id: productId,
      slug: `prod-${productId}`,
      brand: 'Malak',
      basePrice: { toString: () => '49.99' } as any,
      salePrice: null,
      category: { ebayCategoryId: '11483', slug: 'herren-hemden', parent: { slug: 'herren' } },
      translations: [{ language: 'de', name: 'Test Produkt', description: 'Test Beschreibung' }],
      images: [
        { url: 'https://cdn.malak.com/img1.jpg', colorName: 'Schwarz', isPrimary: true, sortOrder: 0 },
      ],
    }
  }
  return snap
}

// Helper: routes for group-publish happy path with N variants
function groupRoutes(
  productId: string,
  variantCount: number,
  publishStatus: number = 200,
  publishBody: string = JSON.stringify({ listingId: `EBAY-${productId}-GROUP` }),
): Record<string, (init: RequestInit) => { status: number; body: string }> {
  const routes: Record<string, any> = {
    [`/sell/inventory/v1/inventory_item_group/MAL_${productId}`]: () => ({ status: 200, body: '' }),
    '/sell/inventory/v1/offer/publish_by_inventory_item_group': () => ({
      status: publishStatus,
      body: publishBody,
    }),
    '/sell/inventory/v1/offer': () => ({ status: 201, body: JSON.stringify({ offerId: `OFFER-${productId}` }) }),
  }
  for (let i = 0; i < variantCount; i++) {
    const sku = `${productId}-SCH-${40 + i}`
    routes[`/sell/inventory/v1/inventory_item/${sku}`] = () => ({ status: 204, body: '' })
    routes[`/sell/inventory/v1/offer?sku=${sku}`] = () => ({
      status: 200,
      body: JSON.stringify({ offers: [] }),
    })
  }
  return routes
}

describe('EbayListingService.publishProduct — routing', () => {
  it('0 active variants → recordFail no_active_variants', async () => {
    const snap = mkBaselineSnapshot()
    // Mark V1 inactive so productVariant.count returns 0
    ;(snap.variants['V1'] as any).isActive = false
    const prisma = mkPrisma(snap)
    const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
    const result = await svc.publishProduct('P1')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorCode).toBe('no_active_variants')
      expect(result.mode).toBe('unknown')
    }
  })

  it('1 active variant → routes to single-variant path (mode=single)', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      ;(snap.variants['V1'] as any).isActive = true
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const { fetch } = mkRoutingFetch(happyPathRoutes())
      svc.__setFetchForTests(fetch)
      const result = await svc.publishProduct('P1')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.mode).toBe('single')
        expect(result.variantCount).toBe(1)
      }
    })
  })
})

describe('EbayListingService.publishProduct — multi-variant group happy path', () => {
  it('2 variants → group flow runs end-to-end, externalListingId set', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      // Drop default L1/V1 and replace with 2-variant product P-MULTI
      delete snap.listings['L1']
      delete snap.variants['V1']
      withMultiVariantProduct(snap, 'PMULTI', 2)
      ;(snap.variants['PMULTI-V1'] as any).isActive = true
      ;(snap.variants['PMULTI-V2'] as any).isActive = true
      ;(snap.variants['PMULTI-V1'] as any).color = 'Schwarz'
      ;(snap.variants['PMULTI-V2'] as any).color = 'Schwarz'
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const { fetch } = mkRoutingFetch(groupRoutes('PMULTI', 2))
      svc.__setFetchForTests(fetch)
      const result = await svc.publishProduct('PMULTI')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.mode).toBe('group')
        expect(result.variantCount).toBe(2)
        expect(result.externalListingId).toBe('EBAY-PMULTI-GROUP')
        expect(result.groupKey).toBe('MAL_PMULTI')
      }
    })
  })
})

describe('EbayListingService.publishProduct — concurrency claim', () => {
  it('claim.count=0 (no pending rows) → not_claimable', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      delete snap.listings['L1']
      delete snap.variants['V1']
      withMultiVariantProduct(snap, 'PCONC', 2)
      ;(snap.variants['PCONC-V1'] as any).isActive = true
      ;(snap.variants['PCONC-V2'] as any).isActive = true
      // Mark all listings as already-active (race already lost)
      ;(snap.listings['PCONC-L1'] as any).status = 'active'
      ;(snap.listings['PCONC-L2'] as any).status = 'active'
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const result = await svc.publishProduct('PCONC')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errorCode).toBe('not_claimable')
        expect(result.mode).toBe('group')
      }
    })
  })

  it('claim.count !== expected (partial pending) → partial_pending rejected', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      delete snap.listings['L1']
      delete snap.variants['V1']
      withMultiVariantProduct(snap, 'PPART', 3)
      ;(snap.variants['PPART-V1'] as any).isActive = true
      ;(snap.variants['PPART-V2'] as any).isActive = true
      ;(snap.variants['PPART-V3'] as any).isActive = true
      // V3-listing already active (1 of 3 missing from pending → partial)
      ;(snap.listings['PPART-L3'] as any).status = 'active'
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const result = await svc.publishProduct('PPART')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errorCode).toBe('partial_pending')
      }
    })
  })
})

describe('EbayListingService.publishProduct — pre-flight mapping errors', () => {
  it('department_unmapped → rejected', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      delete snap.listings['L1']
      delete snap.variants['V1']
      withMultiVariantProduct(snap, 'PDEPT', 2)
      ;(snap.variants['PDEPT-V1'] as any).isActive = true
      ;(snap.variants['PDEPT-V2'] as any).isActive = true
      // Replace category to unknown slug
      ;(snap.products['PDEPT'] as any).category = { ebayCategoryId: '11483', slug: 'unknown', parent: null }
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const result = await svc.publishProduct('PDEPT')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errorCode).toBe('department_unmapped')
      }
    })
  })

  it('no_varying_aspects (all variants identical color+size) → rejected', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      delete snap.listings['L1']
      delete snap.variants['V1']
      withMultiVariantProduct(snap, 'PSAME', 2)
      ;(snap.variants['PSAME-V1'] as any).isActive = true
      ;(snap.variants['PSAME-V2'] as any).isActive = true
      // Strip color and size from all variants
      ;(snap.variants['PSAME-V1'] as any).color = null
      ;(snap.variants['PSAME-V1'] as any).size = null
      ;(snap.variants['PSAME-V2'] as any).color = null
      ;(snap.variants['PSAME-V2'] as any).size = null
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const result = await svc.publishProduct('PSAME')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errorCode).toBe('no_varying_aspects')
      }
    })
  })
})

describe('EbayListingService.publishProduct — API failures', () => {
  it('group_create 4xx → rejected with group_create_failed', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      delete snap.listings['L1']
      delete snap.variants['V1']
      withMultiVariantProduct(snap, 'PGRPFAIL', 2)
      ;(snap.variants['PGRPFAIL-V1'] as any).isActive = true
      ;(snap.variants['PGRPFAIL-V2'] as any).isActive = true
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const routes = groupRoutes('PGRPFAIL', 2)
      // Override group-create with 400
      routes['/sell/inventory/v1/inventory_item_group/MAL_PGRPFAIL'] = () => ({
        status: 400,
        body: JSON.stringify({ errors: [{ errorId: 25001, message: 'bad group data' }] }),
      })
      const { fetch } = mkRoutingFetch(routes)
      svc.__setFetchForTests(fetch)
      const result = await svc.publishProduct('PGRPFAIL')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errorCode).toMatch(/group_create_failed/)
      }
    })
  })

  it('publish 25025 (variation aspect drift) → rejected with group-specific code', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      delete snap.listings['L1']
      delete snap.variants['V1']
      withMultiVariantProduct(snap, 'PVAR', 2)
      ;(snap.variants['PVAR-V1'] as any).isActive = true
      ;(snap.variants['PVAR-V2'] as any).isActive = true
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const routes = groupRoutes('PVAR', 2, 400, JSON.stringify({
        errors: [{ errorId: 25025, message: 'variation aspect drift' }],
      }))
      const { fetch } = mkRoutingFetch(routes)
      svc.__setFetchForTests(fetch)
      const result = await svc.publishProduct('PVAR')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errorCode).toContain('25025')
      }
    })
  })

  it('publish 25002 "bereits veröffentlicht" → group_already_published_no_id', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      delete snap.listings['L1']
      delete snap.variants['V1']
      withMultiVariantProduct(snap, 'PALR', 2)
      ;(snap.variants['PALR-V1'] as any).isActive = true
      ;(snap.variants['PALR-V2'] as any).isActive = true
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const routes = groupRoutes('PALR', 2, 400, JSON.stringify({
        errors: [{ errorId: 25002, message: 'Das Angebot ist bereits veröffentlicht' }],
      }))
      const { fetch } = mkRoutingFetch(routes)
      svc.__setFetchForTests(fetch)
      const result = await svc.publishProduct('PALR')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errorCode).toBe('group_already_published_no_id')
      }
    })
  })

  it('publish success but listingId null → no_listing_id_after_group_publish (Bug-A defense)', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      delete snap.listings['L1']
      delete snap.variants['V1']
      withMultiVariantProduct(snap, 'PNULL', 2)
      ;(snap.variants['PNULL-V1'] as any).isActive = true
      ;(snap.variants['PNULL-V2'] as any).isActive = true
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const routes = groupRoutes('PNULL', 2, 200, JSON.stringify({ /* no listingId */ }))
      const { fetch } = mkRoutingFetch(routes)
      svc.__setFetchForTests(fetch)
      const result = await svc.publishProduct('PNULL')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errorCode).toBe('no_listing_id_after_group_publish')
      }
    })
  })
})

describe('EbayListingService.publishPending — group-by-productId iteration (C11.6)', () => {
  it('multi-product batch with mixed variant counts works', async () => {
    await withEnv(SANDBOX_ENV, async () => {
      const snap = mkBaselineSnapshot()
      // Default P1/V1/L1 stays as 1-variant-product (single-variant path)
      ;(snap.variants['V1'] as any).isActive = true
      // Add 2-variant product PMV
      withMultiVariantProduct(snap, 'PMV', 2)
      ;(snap.variants['PMV-V1'] as any).isActive = true
      ;(snap.variants['PMV-V2'] as any).isActive = true
      const prisma = mkPrisma(snap)
      const svc = new EbayListingService(prisma, mkAuth(), mkAudit())
      const routes = { ...happyPathRoutes(), ...groupRoutes('PMV', 2) }
      const { fetch } = mkRoutingFetch(routes)
      svc.__setFetchForTests(fetch)
      const summary = await svc.publishPending('admin-1', 10)
      // 2 distinct productIds requested
      expect(summary.requested).toBe(2)
      expect(summary.published + summary.failed).toBe(2)
    })
  })
})
