/**
 * Tests for InventoryListener (C12.3 — first test coverage).
 *
 * Existing handler reacts to BOTH OrderCreatedEvent (shop) and
 * MarketplaceOrderImportedEvent (marketplace) via two @OnEvent
 * decorators on the same method. Body is shape-compatible — both
 * events expose orderId, orderNumber, correlationId, items[].
 *
 * Tests verify the reservation flow + compensation rollback work
 * identically for both event types.
 */

import { InventoryListener } from '../listeners/inventory.listener'
import { OrderCreatedEvent } from '../events/order.events'
import { MarketplaceOrderImportedEvent } from '../events/marketplace-order-imported.event'

type AnyJest = jest.Mock<any, any>

function buildReservationService() {
  return {
    reserve: jest.fn(),
    release: jest.fn().mockResolvedValue(undefined),
    confirm: jest.fn().mockResolvedValue(undefined),
  } as any
}

function buildItems() {
  return [
    {
      variantId: 'v-1',
      warehouseId: 'wh-1',
      quantity: 2,
      reservationSessionId: 'sess-1',
    },
  ]
}

// ── OrderCreatedEvent (shop path — baseline) ────────────────

describe('InventoryListener.handleOrderCreated — OrderCreatedEvent', () => {
  it('reserves stock and returns reservation IDs', async () => {
    const reservationService = buildReservationService()
    ;(reservationService.reserve as AnyJest).mockResolvedValue({ id: 'res-1' })
    const listener = new InventoryListener(reservationService)
    const event = new OrderCreatedEvent('order-1', 'ORD-001', 'corr-1', buildItems())

    const result = await listener.handleOrderCreated(event)

    expect(result).toEqual(['res-1'])
    expect(reservationService.reserve).toHaveBeenCalledWith({
      variantId: 'v-1',
      warehouseId: 'wh-1',
      quantity: 2,
      orderId: 'order-1',
      sessionId: 'sess-1',
    })
  })

  it('compensation: releases prior reservations on failure', async () => {
    const reservationService = buildReservationService()
    ;(reservationService.reserve as AnyJest)
      .mockResolvedValueOnce({ id: 'res-1' })
      .mockRejectedValueOnce(new Error('insufficient stock on item 2'))
    const listener = new InventoryListener(reservationService)
    const items = [
      ...buildItems(),
      { variantId: 'v-2', warehouseId: 'wh-1', quantity: 1, reservationSessionId: 'sess-1' },
    ]
    const event = new OrderCreatedEvent('order-2', 'ORD-002', 'corr-2', items)

    await expect(listener.handleOrderCreated(event)).rejects.toThrow(/insufficient/)
    expect(reservationService.release).toHaveBeenCalledWith(
      'res-1',
      expect.stringContaining('compensation-rollback'),
    )
  })
})

// ── MarketplaceOrderImportedEvent (C12.3 path — additive) ──

describe('InventoryListener.handleOrderCreated — MarketplaceOrderImportedEvent', () => {
  it('reservation flow runs identically for marketplace event', async () => {
    const reservationService = buildReservationService()
    ;(reservationService.reserve as AnyJest).mockResolvedValue({ id: 'res-mp-1' })
    const listener = new InventoryListener(reservationService)
    const event = new MarketplaceOrderImportedEvent(
      'order-mp-1',
      'ORD-MP-001',
      'EBAY',
      'EX-1',
      'corr-mp-1',
      buildItems(),
    )

    const result = await listener.handleOrderCreated(event)

    expect(result).toEqual(['res-mp-1'])
    expect(reservationService.reserve).toHaveBeenCalledWith({
      variantId: 'v-1',
      warehouseId: 'wh-1',
      quantity: 2,
      orderId: 'order-mp-1',
      sessionId: 'sess-1',
    })
  })

  it('compensation rollback works for marketplace event failure', async () => {
    const reservationService = buildReservationService()
    ;(reservationService.reserve as AnyJest)
      .mockResolvedValueOnce({ id: 'res-mp-1' })
      .mockRejectedValueOnce(new Error('reserve failed'))
    const listener = new InventoryListener(reservationService)
    const items = [
      ...buildItems(),
      { variantId: 'v-2', warehouseId: 'wh-1', quantity: 1, reservationSessionId: 'sess-1' },
    ]
    const event = new MarketplaceOrderImportedEvent(
      'order-mp-2',
      'ORD-MP-002',
      'EBAY',
      'EX-2',
      'corr-mp-2',
      items,
    )

    await expect(listener.handleOrderCreated(event)).rejects.toThrow(/reserve failed/)
    expect(reservationService.release).toHaveBeenCalledWith(
      'res-mp-1',
      expect.stringContaining('compensation-rollback'),
    )
  })
})
