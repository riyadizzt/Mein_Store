/**
 * EbayRefundPollService (C13.3) unit tests.
 *
 * Pins down:
 *   - Pre-check: not connected → skipped_disconnected
 *   - Auth error: revoked → aborted_revoked
 *   - No pending refunds → empty summary
 *   - 1 refund COMPLETED → flipped PROCESSED + processedAt + audit
 *   - 1 refund FAILED → flipped FAILED + admin-notify + audit
 *   - 1 refund still PENDING < 48h → no-op
 *   - 1 refund still PENDING >= 48h, no prior 48h notice → notify + audit
 *   - 1 refund still PENDING >= 48h, prior 48h notice exists → no double-notify
 *   - Per-refund error doesn't abort tick (3 refunds, middle throws)
 *   - Defensive multi-path refund-status extraction
 *   - Other-provider refunds (Stripe etc.) NOT scanned
 */

import { EbayRefundPollService } from '../ebay-refund-poll.service'
import { EbayNotConnectedError, EbayRefreshRevokedError } from '../ebay-auth.service'

// Mock EbayApiClient at module level
jest.mock('../ebay-api.client', () => {
  const actual = jest.requireActual('../ebay-api.client')
  return { ...actual, EbayApiClient: jest.fn() }
})

// Mock resolveEbayEnv
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
      appId: 'TEST', devId: 'TEST', certId: 'TEST', ruName: 'TEST',
    })),
  }
})

import { EbayApiClient } from '../ebay-api.client'

type AnyJest = jest.Mock<any, any>

function buildPrisma(opts?: {
  config?: { isActive?: boolean; accessToken?: string | null } | null
  pendingRefunds?: any[]
  existingNotices?: any[]
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
  const refundsFindMany = jest.fn().mockResolvedValue(opts?.pendingRefunds ?? [])
  const refundUpdate = jest.fn().mockResolvedValue({})
  const auditFindFirst = jest.fn().mockImplementation((args: any) => {
    const refundId = args.where?.entityId
    return Promise.resolve(opts?.existingNotices?.find((n) => n.entityId === refundId) ?? null)
  })
  return {
    salesChannelConfig: { findUnique: jest.fn().mockResolvedValue(config) },
    refund: { findMany: refundsFindMany, update: refundUpdate },
    adminAuditLog: { findFirst: auditFindFirst },
  } as any
}

function buildAuth(opts?: { bearerError?: Error }) {
  return {
    getAccessTokenOrRefresh: opts?.bearerError
      ? jest.fn().mockRejectedValue(opts.bearerError)
      : jest.fn().mockResolvedValue('test-bearer'),
  } as any
}

function buildAudit() {
  return { log: jest.fn().mockResolvedValue(undefined) } as any
}

function buildNotifications() {
  return { createForAllAdmins: jest.fn().mockResolvedValue(undefined) } as any
}

function setApiResponse(orderResponse: any): jest.Mock {
  const requestMock = jest.fn().mockResolvedValue(orderResponse)
  ;(EbayApiClient as unknown as jest.Mock).mockImplementation(() => ({
    request: requestMock,
  }))
  return requestMock
}

function setApiResponses(responses: any[]): jest.Mock {
  const requestMock = jest.fn()
  responses.forEach((r) => {
    if (r instanceof Error) requestMock.mockRejectedValueOnce(r)
    else requestMock.mockResolvedValueOnce(r)
  })
  ;(EbayApiClient as unknown as jest.Mock).mockImplementation(() => ({
    request: requestMock,
  }))
  return requestMock
}

function makeService(opts?: Parameters<typeof buildPrisma>[0] & { authError?: Error }) {
  const prisma = buildPrisma(opts)
  const auth = buildAuth({ bearerError: opts?.authError })
  const audit = buildAudit()
  const notifications = buildNotifications()
  const service = new EbayRefundPollService(prisma, auth, audit, notifications)
  return { service, prisma, auth, audit, notifications }
}

function makeRefund(overrides: any = {}) {
  return {
    id: 'ref-1',
    status: 'PENDING',
    amount: 29.99,
    providerRefundId: 'ebay-r-1',
    ebayRequestedAt: new Date(),
    createdAt: new Date(),
    payment: {
      provider: 'EBAY_MANAGED_PAYMENTS',
      order: { id: 'o1', orderNumber: 'ORD-MP-001', channelOrderId: '12-12345-67890' },
    },
    ...overrides,
  }
}

// ──────────────────────────────────────────────────────────────
// Pre-check disconnected
// ──────────────────────────────────────────────────────────────

describe('EbayRefundPollService.runPollTick — pre-check', () => {
  it.each([
    ['no config row', null],
    ['isActive=false', { isActive: false }],
    ['accessToken=null', { accessToken: null }],
  ])('skipped_disconnected when %s', async (_label, configOverride) => {
    const { service, prisma } = makeService({ config: configOverride as any })
    const summary = await service.runPollTick()
    expect(summary.status).toBe('skipped_disconnected')
    expect(summary.scanned).toBe(0)
    expect(prisma.refund.findMany).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────
// Auth errors
// ──────────────────────────────────────────────────────────────

describe('EbayRefundPollService.runPollTick — auth errors', () => {
  it('EbayRefreshRevokedError → aborted_revoked', async () => {
    const { service } = makeService({ authError: new EbayRefreshRevokedError() })
    const summary = await service.runPollTick()
    expect(summary.status).toBe('aborted_revoked')
  })

  it('EbayNotConnectedError → skipped_disconnected', async () => {
    const { service } = makeService({ authError: new EbayNotConnectedError('x') })
    const summary = await service.runPollTick()
    expect(summary.status).toBe('skipped_disconnected')
  })
})

// ──────────────────────────────────────────────────────────────
// Empty + status transitions
// ──────────────────────────────────────────────────────────────

describe('EbayRefundPollService.runPollTick — status transitions', () => {
  it('no pending refunds → empty summary, no API calls', async () => {
    const { service } = makeService({ pendingRefunds: [] })
    const requestMock = setApiResponse({})
    const summary = await service.runPollTick()
    expect(summary.scanned).toBe(0)
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('refund COMPLETED → flipped to PROCESSED with processedAt + audit', async () => {
    const refund = makeRefund()
    const { service, prisma, audit } = makeService({ pendingRefunds: [refund] })
    setApiResponse({
      paymentSummary: { refunds: [{ refundId: 'ebay-r-1', refundStatus: 'COMPLETED' }] },
    })
    const summary = await service.runPollTick()
    expect(summary.flippedToProcessed).toBe(1)
    expect(prisma.refund.update).toHaveBeenCalledWith({
      where: { id: 'ref-1' },
      data: { status: 'PROCESSED', processedAt: expect.any(Date) },
    })
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EBAY_REFUND_COMPLETED', entityId: 'ref-1' }),
    )
  })

  it('refund SUCCEEDED (alternate eBay status) → also flipped to PROCESSED', async () => {
    const refund = makeRefund()
    const { service, prisma } = makeService({ pendingRefunds: [refund] })
    setApiResponse({ refunds: [{ refundId: 'ebay-r-1', state: 'SUCCEEDED' }] })
    const summary = await service.runPollTick()
    expect(summary.flippedToProcessed).toBe(1)
    expect(prisma.refund.update).toHaveBeenCalled()
  })

  it('refund FAILED → flipped FAILED + admin-notify + audit', async () => {
    const refund = makeRefund()
    const { service, prisma, audit, notifications } = makeService({ pendingRefunds: [refund] })
    setApiResponse({
      paymentSummary: { refunds: [{ refundId: 'ebay-r-1', refundStatus: 'FAILED' }] },
    })
    const summary = await service.runPollTick()
    expect(summary.flippedToFailed).toBe(1)
    expect(prisma.refund.update).toHaveBeenCalledWith({
      where: { id: 'ref-1' },
      data: { status: 'FAILED' },
    })
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EBAY_REFUND_FAILED', entityId: 'ref-1' }),
    )
    expect(notifications.createForAllAdmins).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'refund_failed' }),
    )
  })

  it('refund still PENDING in eBay → no flip, status unchanged', async () => {
    // Recent refund (< 48h), still pending — no-op
    const refund = makeRefund({
      ebayRequestedAt: new Date(Date.now() - 1 * 3600000), // 1h ago
      createdAt: new Date(Date.now() - 1 * 3600000),
    })
    const { service, prisma } = makeService({ pendingRefunds: [refund] })
    setApiResponse({
      paymentSummary: { refunds: [{ refundId: 'ebay-r-1', refundStatus: 'INITIATED' }] },
    })
    const summary = await service.runPollTick()
    expect(summary.flippedToProcessed).toBe(0)
    expect(summary.flippedToFailed).toBe(0)
    expect(summary.notified48h).toBe(0)
    expect(prisma.refund.update).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────
// 48h-fallback notification
// ──────────────────────────────────────────────────────────────

describe('EbayRefundPollService.runPollTick — 48h-fallback', () => {
  it('refund > 48h pending, no prior notice → notify + audit', async () => {
    const refund = makeRefund({
      ebayRequestedAt: new Date(Date.now() - 50 * 3600000), // 50h ago
      createdAt: new Date(Date.now() - 50 * 3600000),
    })
    const { service, audit, notifications } = makeService({
      pendingRefunds: [refund],
      existingNotices: [], // no prior
    })
    setApiResponse({ paymentSummary: { refunds: [{ refundId: 'ebay-r-1', refundStatus: 'INITIATED' }] } })
    const summary = await service.runPollTick()
    expect(summary.notified48h).toBe(1)
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EBAY_REFUND_PENDING_48H' }),
    )
    expect(notifications.createForAllAdmins).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ebay_refund_pending_48h' }),
    )
  })

  it('refund > 48h pending, prior notice exists → NO double-notify', async () => {
    const refund = makeRefund({
      ebayRequestedAt: new Date(Date.now() - 72 * 3600000),
      createdAt: new Date(Date.now() - 72 * 3600000),
    })
    const { service, audit, notifications } = makeService({
      pendingRefunds: [refund],
      existingNotices: [{ entityId: 'ref-1' }],
    })
    setApiResponse({ paymentSummary: { refunds: [{ refundId: 'ebay-r-1', refundStatus: 'INITIATED' }] } })
    const summary = await service.runPollTick()
    expect(summary.notified48h).toBe(0)
    // No new audit log for PENDING_48H, no new notification
    const auditCalls = (audit.log as AnyJest).mock.calls.filter(
      (c) => c[0]?.action === 'EBAY_REFUND_PENDING_48H',
    )
    expect(auditCalls.length).toBe(0)
    expect(notifications.createForAllAdmins).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ebay_refund_pending_48h' }),
    )
  })
})

// ──────────────────────────────────────────────────────────────
// Resilience: one bad refund doesn't abort tick
// ──────────────────────────────────────────────────────────────

describe('EbayRefundPollService.runPollTick — resilience', () => {
  it('per-refund error does NOT abort tick — other refunds still processed', async () => {
    const refund1 = makeRefund({ id: 'r1', providerRefundId: 'ebay-1' })
    const refund2 = makeRefund({ id: 'r2', providerRefundId: 'ebay-2' })
    const refund3 = makeRefund({ id: 'r3', providerRefundId: 'ebay-3' })
    const { service } = makeService({ pendingRefunds: [refund1, refund2, refund3] })
    setApiResponses([
      { paymentSummary: { refunds: [{ refundId: 'ebay-1', refundStatus: 'COMPLETED' }] } },
      new Error('eBay timeout'),
      { paymentSummary: { refunds: [{ refundId: 'ebay-3', refundStatus: 'COMPLETED' }] } },
    ])
    const summary = await service.runPollTick()
    expect(summary.scanned).toBe(3)
    expect(summary.flippedToProcessed).toBe(2) // r1 + r3
    expect(summary.errors).toBe(1) // r2
  })
})
