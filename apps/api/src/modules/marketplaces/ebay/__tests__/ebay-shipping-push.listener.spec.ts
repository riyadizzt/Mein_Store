/**
 * EbayShippingPushListener (C14) unit tests.
 *
 * Pins down:
 *   1. Filter on toStatus='shipped' — non-shipped transitions skip
 *   2. Filter on order.channel='ebay' — non-eBay orders skip
 *   3. Happy path: shipped + eBay + has shipment → delegates to service
 *   Plus listener catches service throw without leaking.
 */

import { EbayShippingPushListener } from '../ebay-shipping-push.listener'
import { OrderStatusChangedEvent } from '../../../orders/events/order.events'

function buildPrisma(orderShape: any) {
  return {
    order: {
      findUnique: jest.fn().mockResolvedValue(orderShape),
    },
  } as any
}

function makeListener(orderShape: any, pushImpl?: jest.Mock) {
  const prisma = buildPrisma(orderShape)
  const pushService = {
    pushShipment: pushImpl ?? jest.fn().mockResolvedValue({ status: 'pushed', shipmentId: 'ship-1', attempts: 1 }),
  } as any
  return { listener: new EbayShippingPushListener(prisma, pushService), prisma, pushService }
}

function makeEvent(toStatus: string): OrderStatusChangedEvent {
  return new OrderStatusChangedEvent('o1', 'processing', toStatus, 'admin', 'corr-1')
}

// ──────────────────────────────────────────────────────────────

describe('EbayShippingPushListener — STATUS_CHANGED filter', () => {
  it('non-shipped transitions are ignored (no DB lookup)', async () => {
    const { listener, prisma, pushService } = makeListener(null)

    await listener.handleOrderStatusChanged(makeEvent('confirmed'))
    await listener.handleOrderStatusChanged(makeEvent('cancelled'))
    await listener.handleOrderStatusChanged(makeEvent('returned'))
    await listener.handleOrderStatusChanged(makeEvent('refunded'))

    expect(prisma.order.findUnique).not.toHaveBeenCalled()
    expect(pushService.pushShipment).not.toHaveBeenCalled()
  })

  it('shipped on non-eBay channel is ignored after lookup', async () => {
    const { listener, pushService } = makeListener({
      channel: 'website',
      channelOrderId: null,
      shipment: { id: 'ship-1' },
    })

    await listener.handleOrderStatusChanged(makeEvent('shipped'))

    expect(pushService.pushShipment).not.toHaveBeenCalled()
  })

  it('shipped on eBay channel without shipment is ignored', async () => {
    const { listener, pushService } = makeListener({
      channel: 'ebay',
      channelOrderId: '12-12345-67890',
      shipment: null,
    })

    await listener.handleOrderStatusChanged(makeEvent('shipped'))

    expect(pushService.pushShipment).not.toHaveBeenCalled()
  })

  it('shipped + eBay + has shipment → delegates to pushService.pushShipment', async () => {
    const pushImpl = jest.fn().mockResolvedValue({ status: 'pushed', shipmentId: 'ship-xyz', attempts: 1 })
    const { listener, pushService } = makeListener(
      {
        channel: 'ebay',
        channelOrderId: '12-12345-67890',
        shipment: { id: 'ship-xyz' },
      },
      pushImpl,
    )

    await listener.handleOrderStatusChanged(makeEvent('shipped'))

    expect(pushService.pushShipment).toHaveBeenCalledWith('ship-xyz')
  })

  it('listener swallows service throw — caller (status-changed event) is unaffected', async () => {
    const pushImpl = jest.fn().mockRejectedValue(new Error('network blow-up'))
    const { listener } = makeListener(
      {
        channel: 'ebay',
        channelOrderId: '12-12345-67890',
        shipment: { id: 'ship-zzz' },
      },
      pushImpl,
    )

    // Must not throw — listener has its own try/catch
    await expect(listener.handleOrderStatusChanged(makeEvent('shipped'))).resolves.toBeUndefined()
  })
})
