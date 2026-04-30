/**
 * EbayShippingPushListener (C14).
 *
 * Listens to ORDER_EVENTS.STATUS_CHANGED and triggers a synchronous
 * eBay shipping_fulfillment push when:
 *   - toStatus === 'shipped'
 *   - the order's local Shipment row has a tracking number
 *   - (the service further filters on order.channel === 'ebay')
 *
 * Why STATUS_CHANGED (not a new shipment.created event):
 *   shipments.service.createShipment() already emits STATUS_CHANGED
 *   for shipped-transitions (order-email.listener consumes it). We
 *   piggyback to keep ZERO TOUCH on shipments.service.
 *
 * Why fail-and-forget here:
 *   The service handles all retry / persistence / admin-notify logic.
 *   This listener just resolves the shipment and delegates. Errors
 *   bubble to the cron retry-tick (every 30min, max 5 attempts).
 *
 * Hard-rules:
 *   - shipments.service ZERO TOUCH (we listen on existing event)
 *   - DHL provider ZERO TOUCH
 *   - One findFirst query per shipped-transition is the only DB cost
 */

import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { PrismaService } from '../../../prisma/prisma.service'
import {
  ORDER_EVENTS,
  OrderStatusChangedEvent,
} from '../../orders/events/order.events'
import { EbayShippingPushService } from './ebay-shipping-push.service'

@Injectable()
export class EbayShippingPushListener {
  private readonly logger = new Logger(EbayShippingPushListener.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushService: EbayShippingPushService,
  ) {}

  @OnEvent(ORDER_EVENTS.STATUS_CHANGED)
  async handleOrderStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
    // Filter: only fire on shipped-transitions
    if (event.toStatus !== 'shipped') return

    try {
      // Resolve order channel + the freshly-created shipment
      const order = await this.prisma.order.findUnique({
        where: { id: event.orderId },
        select: {
          channel: true,
          channelOrderId: true,
          shipment: { select: { id: true } },
        },
      })
      if (!order || order.channel !== 'ebay') return
      if (!order.channelOrderId || !order.shipment) return

      // Delegate — service handles channel/tracking checks + DB persistence
      // + audit + admin-notify. Never throws on business outcomes.
      const result = await this.pushService.pushShipment(order.shipment.id)
      this.logger.log(
        `[${event.correlationId}] eBay shipping push: ${result.status} (shipment=${order.shipment.id})`,
      )
    } catch (err: any) {
      // Listener-level catch: defensive against any unexpected throw
      // (DB lookup failure, etc.). The cron picks up failed shipments
      // on its next tick.
      this.logger.error(
        `[${event.correlationId}] eBay shipping listener failed: ${err?.message ?? err}`,
      )
    }
  }
}
