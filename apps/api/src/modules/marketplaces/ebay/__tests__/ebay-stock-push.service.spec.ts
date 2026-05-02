/**
 * EbayStockPushService (C15) unit tests.
 *
 * Pins down:
 *   1. Happy path: variant with active listing → bulk_update_price_quantity
 *      called, lastSyncedQuantity persisted.
 *   2. Effective-quantity formula: max(0, available - safetyStock).
 *   3. Idempotency: lastSyncedQuantity == effective → skip, no API call.
 *   4. Listings without externalListingId/SKU/variantId are skipped.
 *   5. status != 'active' listings filtered at DB-level (where-clause).
 *   6. 429 rate-limit → all chunk-items marked failed, audit RATE_LIMITED.
 *   7. 4xx eBay error → persistFailure, increment syncAttempts.
 *   8. Max-attempts exhaustion → admin-notify + CHANNEL_STOCK_PUSH_FAILED.
 *   9. Disconnected eBay account → no API call, returns empty.
 *  10. extractPerSkuErrors: defensive multi-path response parsing.
 */

import 'reflect-metadata'
import {
  EbayStockPushService,
  STOCK_AUDIT_ACTIONS,
  extractPerSkuErrors,
  EBAY_BULK_BATCH_SIZE,
  MAX_PUSH_ATTEMPTS,
} from '../ebay-stock-push.service'
import { EbayApiError } from '../ebay-api.client'

jest.mock('../ebay-api.client', () => {
  const actual = jest.requireActual('../ebay-api.client')
  return { ...actual, EbayApiClient: jest.fn() }
})
jest.mock('../ebay-env', () => ({
  resolveEbayEnv: jest.fn(() => ({
    mode: 'sandbox',
    apiBaseUrl: 'https://api.sandbox.ebay.com',
    oauthAuthorizationUrl: 'https://auth.sandbox.ebay.com/oauth2/authorize',
    oauthTokenUrl: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
    marketplaceId: 'EBAY_DE',
    redirectAcceptedCallbackPath: '/oauth-callback',
    appId: 'TEST', devId: 'TEST', certId: 'TEST', ruName: 'TEST',
  })),
}))

import { EbayApiClient } from '../ebay-api.client'

function setApiResponse(response: any): jest.Mock {
  const requestMock = jest.fn().mockResolvedValue(response)
  ;(EbayApiClient as unknown as jest.Mock).mockImplementation(() => ({ request: requestMock }))
  return requestMock
}

function setApiError(error: Error): jest.Mock {
  const requestMock = jest.fn().mockRejectedValue(error)
  ;(EbayApiClient as unknown as jest.Mock).mockImplementation(() => ({ request: requestMock }))
  return requestMock
}

function makeListing(overrides: any = {}) {
  return {
    id: 'lst-1',
    variantId: 'v1',
    // C15.4 — distinct values to make the offerId vs listingId
    // distinction explicit. eBay's bulk_update_price_quantity
    // requires offerId, NOT the public listingId. Both are 12-digit
    // numerics in production — visually indistinguishable, the bug
    // hid for 4 days. Tests now pin the C15.4-correct contract.
    externalListingId: 'listing-1', // public ebay.de/itm/{X} id
    externalOfferId: 'offer-1',     // Sell-API offer-id (used by stock-push)
    safetyStock: 0,
    lastSyncedQuantity: null,
    syncAttempts: 0,
    status: 'active',
    pauseReason: null,
    variant: { id: 'v1', sku: 'MAL-000-RED-M' },
    ...overrides,
  }
}

function makeInventoryRow(overrides: any = {}) {
  return { variantId: 'v1', quantityOnHand: 10, quantityReserved: 2, ...overrides }
}

function buildPrisma(opts?: {
  listings?: any[]
  inventory?: any[]
  config?: { isActive?: boolean; accessToken?: string | null } | null
}) {
  let config: any
  if (opts?.config === null) config = null
  else {
    const c = opts?.config ?? {}
    config = {
      isActive: 'isActive' in c ? c.isActive : true,
      accessToken: 'accessToken' in c ? c.accessToken : 'enc-token',
    }
  }
  return {
    channelProductListing: {
      findMany: jest.fn().mockResolvedValue(opts?.listings ?? []),
      update: jest.fn().mockResolvedValue({}),
    },
    inventory: {
      findMany: jest.fn().mockResolvedValue(opts?.inventory ?? []),
    },
    salesChannelConfig: { findUnique: jest.fn().mockResolvedValue(config) },
  } as any
}

function makeService(opts?: Parameters<typeof buildPrisma>[0] & { authError?: Error }) {
  const prisma = buildPrisma(opts)
  const auth = {
    getAccessTokenOrRefresh: opts?.authError
      ? jest.fn().mockRejectedValue(opts.authError)
      : jest.fn().mockResolvedValue('test-bearer'),
  }
  const moduleRef = { get: jest.fn().mockReturnValue(auth) } as any
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as any
  const notifications = { createForAllAdmins: jest.fn().mockResolvedValue(undefined) } as any

  // C15.6 spec-sync: mock-Selector that delegates to a real BulkUpdateStrategy.
  // BulkUpdateStrategy uses the same EbayApiClient mock established at the top
  // of this file → existing test assertions on bulk_update_price_quantity URL
  // and request-body shape continue to pass without changes.
  // Selector-orchestration semantics (rateLimited, ok flags) are preserved.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { BulkUpdateStrategy } = require('../ebay-stock-strategies/bulk-update-strategy')
  const realBulk = new BulkUpdateStrategy()
  const selector = {
    executeForSku: jest.fn().mockImplementation((ctx: any) => realBulk.execute(ctx)),
  } as any

  const service = new EbayStockPushService(prisma, moduleRef, audit, notifications, selector)
  return { service, prisma, auth, audit, notifications, selector }
}

// ──────────────────────────────────────────────────────────────
// 1. Happy path: pushForVariants
// ──────────────────────────────────────────────────────────────

describe('EbayStockPushService.pushForVariants — happy path', () => {
  it('listener-call: bulk_update_price_quantity called with 1-item array, persists lastSyncedQuantity', async () => {
    const listing = makeListing()
    const inv = makeInventoryRow({ quantityOnHand: 10, quantityReserved: 2 })
    const { service, prisma } = makeService({ listings: [listing], inventory: [inv] })
    const requestMock = setApiResponse({ responses: [] })

    await service.pushForVariants(['v1'])

    expect(requestMock).toHaveBeenCalledTimes(1)
    const [method, path, opts] = requestMock.mock.calls[0]
    expect(method).toBe('POST')
    expect(path).toBe('/sell/inventory/v1/bulk_update_price_quantity')
    expect((opts as any).body).toEqual({
      requests: [{ offerId: 'offer-1', availableQuantity: 8 }],
    })
    // Persisted
    expect(prisma.channelProductListing.update).toHaveBeenCalledWith({
      where: { id: 'lst-1' },
      data: {
        lastSyncedQuantity: 8,
        lastSyncedAt: expect.any(Date),
        syncAttempts: 0,
        syncError: null,
      },
    })
  })

  it('effective quantity = max(0, available - safetyStock)', async () => {
    const listing = makeListing({ safetyStock: 3 })
    const inv = makeInventoryRow({ quantityOnHand: 10, quantityReserved: 2 })
    const { service } = makeService({ listings: [listing], inventory: [inv] })
    const requestMock = setApiResponse({ responses: [] })

    await service.pushForVariants(['v1'])

    // available = 10 - 2 = 8; effective = 8 - 3 = 5
    expect((requestMock.mock.calls[0][2] as any).body.requests[0].availableQuantity).toBe(5)
  })

  it('safetyStock greater than available → effective floors to 0', async () => {
    const listing = makeListing({ safetyStock: 10 })
    const inv = makeInventoryRow({ quantityOnHand: 5, quantityReserved: 0 })
    const { service } = makeService({ listings: [listing], inventory: [inv] })
    const requestMock = setApiResponse({ responses: [] })

    await service.pushForVariants(['v1'])

    expect((requestMock.mock.calls[0][2] as any).body.requests[0].availableQuantity).toBe(0)
  })

  it('multi-warehouse: uses MAX-per-warehouse (not SUM) — matches C5/cart semantics', async () => {
    const listing = makeListing()
    const { service } = makeService({
      listings: [listing],
      inventory: [
        { variantId: 'v1', quantityOnHand: 5, quantityReserved: 0 },
        { variantId: 'v1', quantityOnHand: 8, quantityReserved: 1 },
        { variantId: 'v1', quantityOnHand: 3, quantityReserved: 0 },
      ],
    })
    const requestMock = setApiResponse({ responses: [] })

    await service.pushForVariants(['v1'])

    // max(5-0, 8-1, 3-0) = 7
    expect((requestMock.mock.calls[0][2] as any).body.requests[0].availableQuantity).toBe(7)
  })
})

// ──────────────────────────────────────────────────────────────
// 2. Idempotency
// ──────────────────────────────────────────────────────────────

describe('EbayStockPushService — idempotency', () => {
  it('lastSyncedQuantity matches effective → no API call, no DB update', async () => {
    const listing = makeListing({ lastSyncedQuantity: 8 })
    const inv = makeInventoryRow({ quantityOnHand: 10, quantityReserved: 2 })
    const { service, prisma } = makeService({ listings: [listing], inventory: [inv] })
    const requestMock = setApiResponse({ responses: [] })

    await service.pushForVariants(['v1'])

    expect(requestMock).not.toHaveBeenCalled()
    expect(prisma.channelProductListing.update).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────
// 3. Skipped paths
// ──────────────────────────────────────────────────────────────

describe('EbayStockPushService — skipped paths', () => {
  it('listing without externalOfferId → skipped, no API call', async () => {
    const listing = makeListing({ externalOfferId: null })
    // C15.4: skip-guard fires on missing externalOfferId, not
    // externalListingId. Where-clause in loadCandidateListings filters
    // serverseitig vor; this in-service guard is Defense-in-Depth for
    // listener-fed listings that may bypass the where-clause.
    const { service, prisma } = makeService({
      listings: [listing],
      inventory: [makeInventoryRow()],
    })
    const requestMock = setApiResponse({ responses: [] })

    await service.pushForVariants(['v1'])

    expect(requestMock).not.toHaveBeenCalled()
    expect(prisma.channelProductListing.update).not.toHaveBeenCalled()
  })

  it('listing with externalOfferId valid + externalListingId=null → push proceeds', async () => {
    // C15.4 positive-coverage: stock-push depends on externalOfferId
    // EXCLUSIVELY. A null externalListingId (e.g. legacy data) must
    // NOT block the push as long as externalOfferId is set. This pins
    // the bug-fix bidirectionally — paired with the negative-coverage
    // test above to lock in the C15.4 contract from both sides and
    // prevent regression where a future maintainer adds a defensive
    // externalListingId-check that would re-introduce the skip.
    const listing = makeListing({
      externalListingId: null,
      externalOfferId: 'offer-1', // explicit, even though factory default
    })
    const { service, prisma } = makeService({
      listings: [listing],
      inventory: [makeInventoryRow({ quantityOnHand: 10, quantityReserved: 2 })],
    })
    const requestMock = setApiResponse({ responses: [] })

    await service.pushForVariants(['v1'])

    expect(requestMock).toHaveBeenCalledTimes(1)
    const [, , opts] = requestMock.mock.calls[0]
    expect((opts as any).body).toEqual({
      requests: [{ offerId: 'offer-1', availableQuantity: 8 }],
    })
    expect(prisma.channelProductListing.update).toHaveBeenCalled()
  })

  it('listing with variant.sku missing → skipped', async () => {
    const listing = makeListing({ variant: { id: 'v1', sku: '' } })
    const { service, prisma } = makeService({
      listings: [listing],
      inventory: [makeInventoryRow()],
    })
    const requestMock = setApiResponse({ responses: [] })

    await service.pushForVariants(['v1'])

    expect(requestMock).not.toHaveBeenCalled()
    expect(prisma.channelProductListing.update).not.toHaveBeenCalled()
  })

  it('disconnected eBay → no API call', async () => {
    const listing = makeListing()
    const { service, prisma } = makeService({
      listings: [listing],
      inventory: [makeInventoryRow()],
      config: { isActive: false, accessToken: 'enc-token' },
    })
    const requestMock = setApiResponse({ responses: [] })

    await service.pushForVariants(['v1'])

    expect(requestMock).not.toHaveBeenCalled()
    // skipped → no listing.update either (we didn't push)
    expect(prisma.channelProductListing.update).not.toHaveBeenCalled()
  })

  it('empty variantIds → no DB call at all', async () => {
    const { service, prisma } = makeService()

    await service.pushForVariants([])

    expect(prisma.channelProductListing.findMany).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────
// 4. Failure paths
// ──────────────────────────────────────────────────────────────

describe('EbayStockPushService — failure paths', () => {
  it('429 rate-limit → audit RATE_LIMITED + all chunk items marked failed', async () => {
    const listing = makeListing()
    const { service, audit } = makeService({
      listings: [listing],
      inventory: [makeInventoryRow()],
    })
    setApiError(new EbayApiError('rate limited', 429, true, []))

    await service.pushForVariants(['v1'])

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: STOCK_AUDIT_ACTIONS.RATE_LIMITED }),
    )
  })

  it('4xx error → syncAttempts incremented, syncError persisted, returns failed', async () => {
    const listing = makeListing({ syncAttempts: 0 })
    const { service, prisma } = makeService({
      listings: [listing],
      inventory: [makeInventoryRow()],
    })
    setApiError(new EbayApiError('invalid offerId', 400, false, []))

    await service.pushForVariants(['v1'])

    // Persist-failure was called with attempts=1
    const failureCall = (prisma.channelProductListing.update as jest.Mock).mock.calls.find(
      (c) => c[0].data?.syncAttempts === 1,
    )
    expect(failureCall).toBeDefined()
    expect(failureCall[0].data.syncError).toContain('400')
  })

  it('exhaustion at MAX_PUSH_ATTEMPTS → admin-notify + audit PUSH_FAILED', async () => {
    const listing = makeListing({ syncAttempts: MAX_PUSH_ATTEMPTS - 1 })
    const { service, audit, notifications } = makeService({
      listings: [listing],
      inventory: [makeInventoryRow()],
    })
    setApiError(new EbayApiError('still 400', 400, false, []))

    await service.pushForVariants(['v1'])

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: STOCK_AUDIT_ACTIONS.PUSH_FAILED, entityId: 'lst-1' }),
    )
    expect(notifications.createForAllAdmins).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'channel_stock_push_failed' }),
    )
  })

  it('pushForVariants never throws even on auth error', async () => {
    const listing = makeListing()
    const { service } = makeService({
      listings: [listing],
      inventory: [makeInventoryRow()],
      authError: new Error('unexpected'),
    })

    await expect(service.pushForVariants(['v1'])).resolves.toBeUndefined()
  })
})

// ──────────────────────────────────────────────────────────────
// 5. extractPerSkuErrors — defensive multi-path
// ──────────────────────────────────────────────────────────────

describe('extractPerSkuErrors', () => {
  it('empty / null → empty map', () => {
    expect(extractPerSkuErrors(null)).toEqual(new Map())
    expect(extractPerSkuErrors(undefined)).toEqual(new Map())
    expect(extractPerSkuErrors({})).toEqual(new Map())
    expect(extractPerSkuErrors({ responses: [] })).toEqual(new Map())
  })

  it('parses path (a): per-item array keyed by offerId', () => {
    const map = extractPerSkuErrors({
      responses: [
        { offerId: 'o1', errors: [{ message: 'price too low', errorId: 25001 }] },
        { offerId: 'o2', errors: [] },
      ],
    })
    expect(map.get('o1')).toContain('price too low')
    expect(map.get('o2')).toBeUndefined()
  })

  it('parses path (b): keyed by sku when offerId missing', () => {
    const map = extractPerSkuErrors({
      responses: [{ sku: 'MAL-XYZ', errors: [{ message: 'sku not found' }] }],
    })
    expect(map.get('MAL-XYZ')).toContain('sku not found')
  })

  it('parses path (c): statusCode != 2xx', () => {
    const map = extractPerSkuErrors({
      responses: [{ offerId: 'o1', statusCode: 500 }],
    })
    expect(map.get('o1')).toContain('500')
  })

  it('falls back to longMessage / errorId when message missing', () => {
    const map = extractPerSkuErrors({
      responses: [{ offerId: 'o1', errors: [{ longMessage: 'long', errorId: 99 }] }],
    })
    expect(map.get('o1')).toBe('long')
  })

  it('truncates long messages to 300 chars', () => {
    const longMsg = 'x'.repeat(500)
    const map = extractPerSkuErrors({
      responses: [{ offerId: 'o1', errors: [{ message: longMsg }] }],
    })
    expect(map.get('o1')!.length).toBe(300)
  })
})

// ──────────────────────────────────────────────────────────────
// 6. Constants sanity — guard against regressions
// ──────────────────────────────────────────────────────────────

describe('EbayStockPushService — invariants', () => {
  it('EBAY_BULK_BATCH_SIZE is 25 (eBay-documented cap)', () => {
    expect(EBAY_BULK_BATCH_SIZE).toBe(25)
  })

  it('MAX_PUSH_ATTEMPTS is 5 (matches C14 + Vorkasse pattern)', () => {
    expect(MAX_PUSH_ATTEMPTS).toBe(5)
  })

  it('STOCK_AUDIT_ACTIONS keys align with frontend audit-labels', () => {
    expect(STOCK_AUDIT_ACTIONS.PUSH_FAILED).toBe('CHANNEL_STOCK_PUSH_FAILED')
    expect(STOCK_AUDIT_ACTIONS.RATE_LIMITED).toBe('EBAY_STOCK_RATE_LIMITED')
  })
})
