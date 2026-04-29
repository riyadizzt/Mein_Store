/**
 * EbayOrderPullService unit tests (C12.5).
 *
 * Mirrors the mock-pattern from ebay-order-notification.service.spec.ts:
 *   - jest.mock('../ebay-api.client', …) for full request() control
 *   - jest.mock('../ebay-env', …) so tests don't trip env validators
 *   - In-memory PrismaService mock (config row + settings JSON)
 *   - In-memory MarketplaceImportService stub returning predetermined outcomes
 *
 * Test layout (12 cases, K-3 merging applied):
 *   1.  Initial run: no cursor → since≈now-24h. Also asserts corrupted-
 *       cursor falls back to 24h (secondary expect).
 *   2.  Subsequent run: cursor → since = cursor-5min
 *   3.  Pre-check parametric: 3 disconnected variants in one block
 *   4.  EbayNotConnectedError from getAccessTokenOrRefresh → skipped
 *   5.  EbayRefreshRevokedError → aborted_revoked, NO notify call
 *   6.  Empty orders array → found=0, no audit row, cursor advanced
 *   7.  Single page 50 orders → all funneled, audit written. Also asserts
 *       audit-log throw is non-blocking (secondary expect).
 *   8.  Two pages with next-link → page-2 path stripped of apiBaseUrl
 *   9.  Hard-cap 1000 → cursor NOT advanced + summary.hardCapHit=true
 *   10. Mixed outcomes (3i + 1s + 1f) → counters correct
 *   11. Glue throws unhandled → caught + counted failed + tick continues
 *   12. Order missing orderId+legacyOrderId → counted failed, no Glue call
 */

import { EbayOrderPullService } from '../ebay-order-pull.service'

// Mock EbayApiClient at the module level — full request() control.
jest.mock('../ebay-api.client', () => {
  const actual = jest.requireActual('../ebay-api.client')
  return {
    ...actual,
    EbayApiClient: jest.fn(),
  }
})

// Mock resolveEbayEnv so we don't trip env-var validation.
jest.mock('../ebay-env', () => {
  const actual = jest.requireActual('../ebay-env')
  return {
    ...actual,
    resolveEbayEnv: jest.fn(() => ({
      mode: 'sandbox',
      apiBaseUrl: 'https://api.sandbox.ebay.com',
      oauthAuthorizationUrl: 'https://auth.sandbox.ebay.com/oauth2/authorize',
      oauthTokenUrl: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
      marketplaceId: 'EBAY_DE',
      redirectAcceptedCallbackPath: '/api/v1/admin/marketplaces/ebay/oauth-callback',
      appId: 'TEST',
      devId: 'TEST',
      certId: 'TEST',
      ruName: 'TEST',
    })),
  }
})

import { EbayApiClient } from '../ebay-api.client'
import { EbayNotConnectedError, EbayRefreshRevokedError } from '../ebay-auth.service'

type AnyJest = jest.Mock<any, any>

// Build minimal Prisma mock — only the salesChannelConfig.findUnique surface.
// Uses `'key' in obj` rather than `??` so explicit `null` survives (the
// disconnected pre-check needs accessToken: null without falling back).
function buildPrisma(opts?: {
  config?: {
    isActive?: boolean
    accessToken?: string | null
    settings?: Record<string, unknown>
  } | null
}) {
  let config: any
  if (opts?.config === null) {
    config = null
  } else {
    const c = opts?.config ?? {}
    config = {
      isActive: 'isActive' in c ? c.isActive : true,
      accessToken: 'accessToken' in c ? c.accessToken : 'enc-token',
      settings: 'settings' in c ? c.settings : {},
    }
  }
  return {
    salesChannelConfig: {
      findUnique: jest.fn().mockResolvedValue(config),
    },
  } as any
}

function buildAuth(opts?: {
  bearer?: string
  bearerError?: Error
  patchSettingsImpl?: (patch: Record<string, unknown>) => Promise<void>
}) {
  return {
    getAccessTokenOrRefresh: opts?.bearerError
      ? jest.fn().mockRejectedValue(opts.bearerError)
      : jest.fn().mockResolvedValue(opts?.bearer ?? 'fresh-bearer'),
    patchSettings: opts?.patchSettingsImpl
      ? jest.fn(opts.patchSettingsImpl)
      : jest.fn().mockResolvedValue(undefined),
  } as any
}

function buildAudit(throws?: boolean) {
  return {
    log: throws
      ? jest.fn().mockRejectedValue(new Error('audit table down'))
      : jest.fn().mockResolvedValue(undefined),
  } as any
}

function buildImport(outcomes?: Array<any>) {
  // outcomes: ordered list of return values (or thrown errors) per call.
  const fn = jest.fn()
  if (outcomes) {
    outcomes.forEach((o) => {
      if (o instanceof Error) fn.mockRejectedValueOnce(o)
      else fn.mockResolvedValueOnce(o)
    })
  } else {
    fn.mockResolvedValue({
      status: 'imported',
      importId: 'imp-x',
      orderId: 'ord-x',
      orderNumber: 'ORD-MP-x',
    })
  }
  return { processMarketplaceOrderEvent: fn } as any
}

function setApiClientPages(pages: Array<any>) {
  // Each page returned in order from EbayApiClient.request().
  const requestMock = jest.fn()
  pages.forEach((p) => requestMock.mockResolvedValueOnce(p))
  ;(EbayApiClient as unknown as jest.Mock).mockImplementation(() => ({
    request: requestMock,
  }))
  return requestMock
}

function makeService(deps: { prisma: any; auth: any; importer: any; audit: any }) {
  return new EbayOrderPullService(deps.prisma, deps.auth, deps.importer, deps.audit)
}

// ──────────────────────────────────────────────────────────────
// Cursor resolution
// ──────────────────────────────────────────────────────────────

describe('EbayOrderPullService.runPullTick — cursor resolution', () => {
  it('initial run: no cursor → since ≈ now-24h, also handles corrupted-cursor fallback', async () => {
    const prisma = buildPrisma({ config: { settings: {} } })
    const auth = buildAuth()
    const importer = buildImport()
    const audit = buildAudit()
    const requestMock = setApiClientPages([{ orders: [], next: null }])

    const svc = makeService({ prisma, auth, importer, audit })
    const before = Date.now()
    const summary = await svc.runPullTick()
    const after = Date.now()

    expect(summary.status).toBe('completed')
    const sinceMs = Date.parse(summary.since)
    const untilMs = Date.parse(summary.until)
    expect(untilMs).toBeGreaterThanOrEqual(before)
    expect(untilMs).toBeLessThanOrEqual(after + 100)
    // 24h ± a bit
    const delta = untilMs - sinceMs
    expect(delta).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 100)
    expect(delta).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000)

    // First request URL contains the creationdate filter
    expect(requestMock).toHaveBeenCalledTimes(1)
    const path = requestMock.mock.calls[0][1] as string
    expect(path).toMatch(/^\/sell\/fulfillment\/v1\/order\?/)
    expect(path).toContain('creationdate%3A%5B') // 'creationdate:[' URL-encoded
    expect(path).toContain('limit=200')

    // Secondary expect: corrupted cursor in a fresh service falls back the same way
    const prisma2 = buildPrisma({
      config: { settings: { lastOrderPullAt: '!!!!not-an-iso!!!!' } },
    })
    setApiClientPages([{ orders: [], next: null }])
    const svc2 = makeService({ prisma: prisma2, auth, importer, audit })
    const sum2 = await svc2.runPullTick()
    const delta2 = Date.parse(sum2.until) - Date.parse(sum2.since)
    expect(delta2).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 100)
    expect(delta2).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000)
  })

  it('subsequent run: cursor present → since = cursor-5min', async () => {
    const cursorIso = '2026-04-29T00:00:00.000Z'
    const prisma = buildPrisma({ config: { settings: { lastOrderPullAt: cursorIso } } })
    const auth = buildAuth()
    const importer = buildImport()
    const audit = buildAudit()
    setApiClientPages([{ orders: [], next: null }])

    const svc = makeService({ prisma, auth, importer, audit })
    const summary = await svc.runPullTick()

    // since = cursor - 5min = 2026-04-28T23:55:00.000Z
    expect(summary.since).toBe('2026-04-28T23:55:00.000Z')
  })
})

// ──────────────────────────────────────────────────────────────
// Pre-check disconnected (parametric)
// ──────────────────────────────────────────────────────────────

describe('EbayOrderPullService.runPullTick — pre-check disconnected', () => {
  it.each([
    ['no config row', null],
    ['isActive=false', { isActive: false }],
    ['accessToken=null', { accessToken: null }],
  ])('skipped_disconnected when %s', async (_label, configOverride) => {
    const prisma = buildPrisma({ config: configOverride as any })
    const auth = buildAuth()
    const importer = buildImport()
    const audit = buildAudit()
    const requestMock = setApiClientPages([])

    const svc = makeService({ prisma, auth, importer, audit })
    const summary = await svc.runPullTick()

    expect(summary.status).toBe('skipped_disconnected')
    expect(summary.found).toBe(0)
    expect(requestMock).not.toHaveBeenCalled()
    expect(auth.getAccessTokenOrRefresh).not.toHaveBeenCalled()
    expect(auth.patchSettings).not.toHaveBeenCalled()
    expect(audit.log).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────
// Auth errors mid-tick
// ──────────────────────────────────────────────────────────────

describe('EbayOrderPullService.runPullTick — auth errors', () => {
  it('EbayNotConnectedError from getAccessTokenOrRefresh → skipped_disconnected, no API call', async () => {
    const prisma = buildPrisma()
    const auth = buildAuth({ bearerError: new EbayNotConnectedError('post-decrypt-fail') })
    const importer = buildImport()
    const audit = buildAudit()
    const requestMock = setApiClientPages([])

    const svc = makeService({ prisma, auth, importer, audit })
    const summary = await svc.runPullTick()

    expect(summary.status).toBe('skipped_disconnected')
    expect(requestMock).not.toHaveBeenCalled()
    expect(auth.patchSettings).not.toHaveBeenCalled()
  })

  it('EbayRefreshRevokedError → aborted_revoked, no notify, no API call', async () => {
    const prisma = buildPrisma()
    const auth = buildAuth({ bearerError: new EbayRefreshRevokedError() })
    const importer = buildImport()
    const audit = buildAudit()
    const requestMock = setApiClientPages([])

    const svc = makeService({ prisma, auth, importer, audit })
    const summary = await svc.runPullTick()

    expect(summary.status).toBe('aborted_revoked')
    expect(requestMock).not.toHaveBeenCalled()
    expect(auth.patchSettings).not.toHaveBeenCalled()
    expect(audit.log).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────
// Empty / single-page / pagination / mixed
// ──────────────────────────────────────────────────────────────

describe('EbayOrderPullService.runPullTick — order processing', () => {
  it('empty orders → no audit row, but cursor IS advanced', async () => {
    const cursorIso = '2026-04-28T12:00:00.000Z'
    const prisma = buildPrisma({ config: { settings: { lastOrderPullAt: cursorIso } } })
    const auth = buildAuth()
    const importer = buildImport()
    const audit = buildAudit()
    setApiClientPages([{ orders: [], next: null }])

    const svc = makeService({ prisma, auth, importer, audit })
    const summary = await svc.runPullTick()

    expect(summary.found).toBe(0)
    expect(audit.log).not.toHaveBeenCalled()
    expect(auth.patchSettings).toHaveBeenCalledWith({ lastOrderPullAt: summary.until })
  })

  it('single page with orders → all funneled to importService, audit written; audit-throw non-blocking', async () => {
    const prisma = buildPrisma()
    const auth = buildAuth()
    const importer = buildImport([
      { status: 'imported', importId: 'i1', orderId: 'o1', orderNumber: 'N1' },
      { status: 'imported', importId: 'i2', orderId: 'o2', orderNumber: 'N2' },
      { status: 'imported', importId: 'i3', orderId: 'o3', orderNumber: 'N3' },
    ])
    const audit = buildAudit(true) // audit.log will throw
    setApiClientPages([
      {
        orders: [{ orderId: 'EX-1' }, { orderId: 'EX-2' }, { orderId: 'EX-3' }],
        next: null,
      },
    ])

    const svc = makeService({ prisma, auth, importer, audit })
    const summary = await svc.runPullTick()

    expect(summary.found).toBe(3)
    expect(summary.imported).toBe(3)
    expect(importer.processMarketplaceOrderEvent).toHaveBeenCalledTimes(3)
    // audit-log was attempted but threw — tick still completes successfully (secondary expect)
    expect(audit.log).toHaveBeenCalledTimes(1)
    expect(summary.status).toBe('completed')
    // Cursor still advanced
    expect(auth.patchSettings).toHaveBeenCalled()
  })

  it('two pages: next-link is stripped of apiBaseUrl prefix and used as relative path', async () => {
    const prisma = buildPrisma()
    const auth = buildAuth()
    const importer = buildImport()
    const audit = buildAudit()
    const requestMock = setApiClientPages([
      {
        orders: [{ orderId: 'EX-A' }],
        next: 'https://api.sandbox.ebay.com/sell/fulfillment/v1/order?filter=foo&offset=200&limit=200',
      },
      { orders: [{ orderId: 'EX-B' }], next: null },
    ])

    const svc = makeService({ prisma, auth, importer, audit })
    const summary = await svc.runPullTick()

    expect(summary.found).toBe(2)
    expect(requestMock).toHaveBeenCalledTimes(2)
    // 2nd call must be the stripped relative path
    const secondPath = requestMock.mock.calls[1][1] as string
    expect(secondPath).toBe('/sell/fulfillment/v1/order?filter=foo&offset=200&limit=200')
  })

  it('hard-cap 1000 → cursor NOT advanced, summary.hardCapHit=true', async () => {
    const prisma = buildPrisma()
    const auth = buildAuth()
    const importer = buildImport()
    const audit = buildAudit()
    // 6 pages × 200 = 1200, but loop breaks at 1000
    const page = (n: number) => ({
      orders: Array.from({ length: 200 }, (_, i) => ({ orderId: `EX-${n}-${i}` })),
      next: 'https://api.sandbox.ebay.com/sell/fulfillment/v1/order?next=' + n,
    })
    const lastPage = {
      orders: Array.from({ length: 200 }, (_, i) => ({ orderId: `EX-LAST-${i}` })),
      next: null,
    }
    setApiClientPages([page(1), page(2), page(3), page(4), page(5), lastPage])

    const svc = makeService({ prisma, auth, importer, audit })
    const summary = await svc.runPullTick()

    expect(summary.found).toBe(1000)
    expect(summary.hardCapHit).toBe(true)
    // Cursor NOT advanced
    expect(auth.patchSettings).not.toHaveBeenCalled()
  })

  it('mixed outcomes 3i + 1s + 1f → counters correct, audit summary correct', async () => {
    const prisma = buildPrisma()
    const auth = buildAuth()
    const importer = buildImport([
      { status: 'imported', importId: 'i1', orderId: 'o1', orderNumber: 'N1' },
      { status: 'imported', importId: 'i2', orderId: 'o2', orderNumber: 'N2' },
      {
        status: 'skipped',
        importId: 'i3',
        reason: 'already_exists',
        existingOrderId: 'o-old',
      },
      { status: 'imported', importId: 'i4', orderId: 'o4', orderNumber: 'N4' },
      {
        status: 'failed',
        importId: 'i5',
        reason: 'mapping fail',
        errorKind: 'mapping',
      },
    ])
    const audit = buildAudit()
    setApiClientPages([
      {
        orders: [
          { orderId: 'EX-1' },
          { orderId: 'EX-2' },
          { orderId: 'EX-3' },
          { orderId: 'EX-4' },
          { orderId: 'EX-5' },
        ],
        next: null,
      },
    ])

    const svc = makeService({ prisma, auth, importer, audit })
    const summary = await svc.runPullTick()

    expect(summary.found).toBe(5)
    expect(summary.imported).toBe(3)
    expect(summary.skipped).toBe(1)
    expect(summary.failed).toBe(1)
    expect(audit.log).toHaveBeenCalledTimes(1)
    const auditCall = (audit.log as AnyJest).mock.calls[0][0]
    expect(auditCall.action).toBe('MARKETPLACE_PULL_TICK_COMPLETED')
    expect(auditCall.changes.after).toMatchObject({
      found: 5,
      imported: 3,
      skipped: 1,
      failed: 1,
    })
  })

  it('Glue throws unhandled → caught, counted as failed, tick continues with next order', async () => {
    const prisma = buildPrisma()
    const auth = buildAuth()
    const importer = buildImport([
      { status: 'imported', importId: 'i1', orderId: 'o1', orderNumber: 'N1' },
      new Error('totally unexpected throw from glue'),
      { status: 'imported', importId: 'i3', orderId: 'o3', orderNumber: 'N3' },
    ])
    const audit = buildAudit()
    setApiClientPages([
      {
        orders: [{ orderId: 'EX-1' }, { orderId: 'EX-2' }, { orderId: 'EX-3' }],
        next: null,
      },
    ])

    const svc = makeService({ prisma, auth, importer, audit })
    const summary = await svc.runPullTick()

    expect(summary.found).toBe(3)
    expect(summary.imported).toBe(2)
    expect(summary.failed).toBe(1)
    // Tick still completes
    expect(summary.status).toBe('completed')
    expect(auth.patchSettings).toHaveBeenCalled()
  })

  it('order missing both orderId and legacyOrderId → counted failed, no Glue call', async () => {
    const prisma = buildPrisma()
    const auth = buildAuth()
    const importer = buildImport([
      { status: 'imported', importId: 'i1', orderId: 'o1', orderNumber: 'N1' },
    ])
    const audit = buildAudit()
    setApiClientPages([
      {
        orders: [
          { orderId: 'EX-good' },
          { /* both missing */ creationDate: '2026-04-29T00:00:00Z' },
        ],
        next: null,
      },
    ])

    const svc = makeService({ prisma, auth, importer, audit })
    const summary = await svc.runPullTick()

    expect(summary.found).toBe(2)
    expect(summary.imported).toBe(1)
    expect(summary.failed).toBe(1)
    // Glue called only once for the good order, NOT for the broken one
    expect(importer.processMarketplaceOrderEvent).toHaveBeenCalledTimes(1)
  })
})
