/**
 * Tests for MarketplaceOversellListener (C12.3).
 *
 * Loose-coupled to OrdersService via EventEmitter — tests instantiate
 * the listener directly and call handleOversellDrift with synthetic
 * payloads.
 */

import { MarketplaceOversellListener } from '../listeners/marketplace-oversell.listener'

type AnyJest = jest.Mock<any, any>

function buildPayload(overrides = {}) {
  return {
    externalOrderId: 'EX-1',
    correlationId: 'corr-1',
    lines: [
      { variantId: 'v-1', sku: 'SKU-1', requested: 5, available: 2 },
      { variantId: 'v-2', sku: 'SKU-2', requested: 3, available: 0 },
    ],
    ...overrides,
  }
}

function buildNotificationService() {
  return {
    createForAllAdmins: jest.fn().mockResolvedValue({}),
  } as any
}

describe('MarketplaceOversellListener', () => {
  it('calls notificationService.createForAllAdmins with correct shape', async () => {
    const notifyService = buildNotificationService()
    const listener = new MarketplaceOversellListener(notifyService)
    await listener.handleOversellDrift(buildPayload())

    expect(notifyService.createForAllAdmins).toHaveBeenCalledTimes(1)
    const call = (notifyService.createForAllAdmins as AnyJest).mock.calls[0][0]
    expect(call.type).toBe('marketplace_oversell_drift')
    expect(call.entityType).toBe('order')
    expect(call.entityId).toBe('EX-1')
    expect(call.data.externalOrderId).toBe('EX-1')
    expect(call.data.lineCount).toBe(2)
    expect(call.data.driftedSkus).toEqual(['SKU-1', 'SKU-2'])
  })

  it('aggregates totalShortage correctly across lines', async () => {
    const notifyService = buildNotificationService()
    const listener = new MarketplaceOversellListener(notifyService)
    await listener.handleOversellDrift(buildPayload())
    // Line 1: 5-2=3, Line 2: 3-0=3 → 6 total
    const call = (notifyService.createForAllAdmins as AnyJest).mock.calls[0][0]
    expect(call.data.totalShortage).toBe(6)
  })

  it('logs error and does NOT throw if notify fails', async () => {
    const notifyService = buildNotificationService()
    ;(notifyService.createForAllAdmins as AnyJest).mockRejectedValue(new Error('DB down'))
    const listener = new MarketplaceOversellListener(notifyService)
    // Must NOT throw — listener swallows errors so import flow never blocks
    await expect(listener.handleOversellDrift(buildPayload())).resolves.toBeUndefined()
  })
})
