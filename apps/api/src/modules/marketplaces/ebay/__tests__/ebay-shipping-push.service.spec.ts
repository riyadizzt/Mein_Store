/**
 * EbayShippingPushService (C14) unit tests.
 *
 * Pins down:
 *   1. Happy path: 2xx → ebayPushedAt set + audit-log + 'pushed'
 *   2. Idempotent pre-check: ebayPushedAt non-null → skipped early
 *   3. Skip non-eBay shipment (channel='website')
 *   4. 4xx 'already registered' → idempotent success-mark
 *   5. 5xx → failed (transient, cron will retry)
 *   6. Disconnected eBay account → skipped_disconnected, no API call
 *   7. Max-attempts exhaustion → admin-notify + EBAY_SHIPPING_PUSH_FAILED audit
 *   Plus retryFailedPushes (cron-callable) batches correctly.
 */

import { EbayShippingPushService } from '../ebay-shipping-push.service'
import { EbayApiError } from '../ebay-api.client'
import { EbayRefreshRevokedError } from '../ebay-auth.service'

jest.mock('../ebay-api.client', () => {
  const actual = jest.requireActual('../ebay-api.client')
  return { ...actual, EbayApiClient: jest.fn() }
})
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

function makeShipment(overrides: any = {}) {
  return {
    id: 'ship-1',
    carrier: 'dhl',
    trackingNumber: '00340434292135100214',
    shippedAt: new Date('2026-04-30T14:25:00.000Z'),
    ebayPushedAt: null as Date | null,
    ebayPushAttempts: 0,
    ebayPushError: null as string | null,
    order: {
      id: 'o1',
      orderNumber: 'ORD-MP-001',
      channel: 'ebay',
      channelOrderId: '12-12345-67890',
    },
    ...overrides,
  }
}

function buildPrisma(opts?: {
  shipment?: any
  config?: { isActive?: boolean; accessToken?: string | null } | null
  candidates?: any[]
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
    shipment: {
      findUnique: jest.fn().mockResolvedValue(opts?.shipment ?? null),
      findMany: jest.fn().mockResolvedValue(opts?.candidates ?? []),
      update: jest.fn().mockResolvedValue({}),
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
  const service = new EbayShippingPushService(prisma, moduleRef, audit, notifications)
  return { service, prisma, auth, audit, notifications }
}

// ──────────────────────────────────────────────────────────────
// 1. Happy path
// ──────────────────────────────────────────────────────────────

describe('EbayShippingPushService.pushShipment — happy path', () => {
  it('2xx → ebayPushedAt set + audit + pushed status', async () => {
    const shipment = makeShipment()
    const { service, prisma, audit } = makeService({ shipment })
    setApiResponse({ /* eBay returns 204 No Content typically; empty body OK */ })

    const result = await service.pushShipment('ship-1')

    expect(result.status).toBe('pushed')
    expect(result.attempts).toBe(1)
    expect(prisma.shipment.update).toHaveBeenCalledWith({
      where: { id: 'ship-1' },
      data: {
        ebayPushedAt: expect.any(Date),
        ebayPushAttempts: 1,
        ebayPushError: null,
      },
    })
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EBAY_SHIPPING_PUSHED', entityId: 'ship-1' }),
    )
  })

  it('sends correct body shape: shippedDate ISO + shippingCarrierCode uppercase + trackingNumber', async () => {
    const shipment = makeShipment()
    const { service } = makeService({ shipment })
    const requestMock = setApiResponse({})

    await service.pushShipment('ship-1')

    const sentBody = requestMock.mock.calls[0][2]?.body
    expect(sentBody).toEqual({
      shippedDate: '2026-04-30T14:25:00.000Z',
      shippingCarrierCode: 'DHL',
      trackingNumber: '00340434292135100214',
    })
    const sentPath = requestMock.mock.calls[0][1] as string
    expect(sentPath).toContain('/sell/fulfillment/v1/order/12-12345-67890/shipping_fulfillment')
  })
})

// ──────────────────────────────────────────────────────────────
// 2. Idempotency
// ──────────────────────────────────────────────────────────────

describe('EbayShippingPushService.pushShipment — idempotency', () => {
  it('already-pushed shipment skipped via DB pre-check, no API call', async () => {
    const shipment = makeShipment({ ebayPushedAt: new Date('2026-04-30T10:00:00Z') })
    const { service, prisma } = makeService({ shipment })
    const requestMock = setApiResponse({})

    const result = await service.pushShipment('ship-1')

    expect(result.status).toBe('already_pushed')
    expect(requestMock).not.toHaveBeenCalled()
    expect(prisma.shipment.update).not.toHaveBeenCalled()
  })

  it('eBay 4xx "already registered" → idempotent success', async () => {
    const shipment = makeShipment()
    const { service, prisma } = makeService({ shipment })
    setApiError(new EbayApiError('Tracking number already registered for this order', 400, false, [], ''))

    const result = await service.pushShipment('ship-1')

    expect(result.status).toBe('pushed') // treated as success
    expect(prisma.shipment.update).toHaveBeenCalledWith({
      where: { id: 'ship-1' },
      data: expect.objectContaining({ ebayPushedAt: expect.any(Date), ebayPushError: null }),
    })
  })
})

// ──────────────────────────────────────────────────────────────
// 3. Skip non-eBay shipment
// ──────────────────────────────────────────────────────────────

describe('EbayShippingPushService.pushShipment — skip non-eBay', () => {
  it('order.channel === "website" → skipped_no_tracking, no API call', async () => {
    const shipment = makeShipment({
      order: { ...makeShipment().order, channel: 'website', channelOrderId: null },
    })
    const { service } = makeService({ shipment })
    const requestMock = setApiResponse({})

    const result = await service.pushShipment('ship-1')
    expect(result.status).toBe('skipped_no_tracking')
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('eBay channel but no tracking number → skipped_no_tracking', async () => {
    const shipment = makeShipment({ trackingNumber: null })
    const { service } = makeService({ shipment })
    const requestMock = setApiResponse({})

    const result = await service.pushShipment('ship-1')
    expect(result.status).toBe('skipped_no_tracking')
    expect(requestMock).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────
// 4. Failure modes
// ──────────────────────────────────────────────────────────────

describe('EbayShippingPushService.pushShipment — failures', () => {
  it('5xx → failed, attempts incremented, ebayPushError set', async () => {
    const shipment = makeShipment()
    const { service, prisma } = makeService({ shipment })
    setApiError(new EbayApiError('Internal Server Error', 503, true, [], ''))

    const result = await service.pushShipment('ship-1')

    expect(result.status).toBe('failed')
    expect(result.attempts).toBe(1)
    expect(prisma.shipment.update).toHaveBeenCalledWith({
      where: { id: 'ship-1' },
      data: {
        ebayPushAttempts: 1,
        ebayPushError: expect.stringContaining('5xx'),
      },
    })
  })

  it('disconnected eBay → skipped_disconnected, no attempt increment', async () => {
    const shipment = makeShipment()
    const { service, prisma } = makeService({ shipment, config: { isActive: false } })
    const requestMock = setApiResponse({})

    const result = await service.pushShipment('ship-1')

    expect(result.status).toBe('skipped_disconnected')
    expect(result.attempts).toBe(0)
    expect(requestMock).not.toHaveBeenCalled()
    expect(prisma.shipment.update).not.toHaveBeenCalled()
  })

  it('refresh-token revoked → aborted_revoked', async () => {
    const shipment = makeShipment()
    const { service } = makeService({ shipment, authError: new EbayRefreshRevokedError() })

    const result = await service.pushShipment('ship-1')
    expect(result.status).toBe('aborted_revoked')
  })
})

// ──────────────────────────────────────────────────────────────
// 5. Max-attempts exhaustion
// ──────────────────────────────────────────────────────────────

describe('EbayShippingPushService.pushShipment — max attempts', () => {
  it('5th failed attempt → admin-notify + EBAY_SHIPPING_PUSH_FAILED audit', async () => {
    const shipment = makeShipment({ ebayPushAttempts: 4 }) // next attempt = 5th = exhausted
    const { service, audit, notifications } = makeService({ shipment })
    setApiError(new EbayApiError('Server error', 500, true, [], ''))

    const result = await service.pushShipment('ship-1')

    expect(result.status).toBe('failed')
    expect(result.attempts).toBe(5)
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EBAY_SHIPPING_PUSH_FAILED', entityId: 'ship-1' }),
    )
    expect(notifications.createForAllAdmins).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ebay_shipping_push_failed' }),
    )
  })

  it('attempt 1-4 failures → no admin-notify (avoid spam during cron-retries)', async () => {
    const shipment = makeShipment({ ebayPushAttempts: 0 })
    const { service, notifications } = makeService({ shipment })
    setApiError(new EbayApiError('Transient', 502, true, [], ''))

    await service.pushShipment('ship-1')

    expect(notifications.createForAllAdmins).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────
// 6. retryFailedPushes (cron-callable)
// ──────────────────────────────────────────────────────────────

describe('EbayShippingPushService.retryFailedPushes — cron tick', () => {
  it('scans pending shipments + processes each, returns counts', async () => {
    const shipment1 = makeShipment({ id: 'ship-1', ebayPushAttempts: 1 })
    const shipment2 = makeShipment({ id: 'ship-2', ebayPushAttempts: 2 })
    const { service, prisma } = makeService({ candidates: [{ id: 'ship-1' }, { id: 'ship-2' }] })

    // Each pushShipment call re-fetches the shipment via findUnique
    let callCount = 0
    ;(prisma.shipment.findUnique as jest.Mock).mockImplementation(({ where }: any) => {
      callCount++
      if (where.id === 'ship-1') return Promise.resolve(shipment1)
      if (where.id === 'ship-2') return Promise.resolve(shipment2)
      return Promise.resolve(null)
    })
    setApiResponse({}) // both succeed

    const summary = await service.retryFailedPushes()

    expect(summary.scanned).toBe(2)
    expect(summary.pushed).toBe(2)
    expect(summary.stillFailed).toBe(0)
  })

  it('no candidates → empty summary, no API calls', async () => {
    const { service } = makeService({ candidates: [] })
    const requestMock = setApiResponse({})

    const summary = await service.retryFailedPushes()

    expect(summary.scanned).toBe(0)
    expect(summary.pushed).toBe(0)
    expect(requestMock).not.toHaveBeenCalled()
  })
})
