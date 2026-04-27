/**
 * Event emitted by OrdersService.createFromMarketplace AFTER the
 * atomic Order+Payment+History transaction has been committed.
 *
 * Distinct from OrderCreatedEvent (which fires for shop orders and
 * triggers the customer-facing email + outbound webhook + bell-
 * notification listeners). Marketplace orders MUST NOT trigger:
 *   - the customer email-listener (would email synthetic
 *     `<ref>@marketplace.local`, bouncing into a black hole and
 *     polluting our Resend reputation)
 *   - the webhook-listener (n8n payload not validated for marketplace
 *     shape — a separate marketplace-specific webhook lands in C14)
 *
 * This event is consumed in C12.3 by:
 *   - InventoryListener.handleOrderCreated (additive @OnEvent decorator
 *     on the existing handler — shape-compatible with OrderCreatedEvent)
 *
 * The C12.6 glue-service is the canonical caller of createFromMarketplace;
 * tests instantiate this event directly to exercise the listener.
 *
 * Items shape mirrors OrderCreatedEvent.items so the inventory listener
 * can reuse the same handler body unchanged (Q-B Option (a)).
 */

export const MARKETPLACE_ORDER_EVENTS = {
  IMPORTED: 'marketplace.order.imported',
} as const

export class MarketplaceOrderImportedEvent {
  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly marketplace: 'EBAY' | 'TIKTOK',
    public readonly externalOrderId: string,
    public readonly correlationId: string,
    public readonly items: Array<{
      variantId: string
      warehouseId: string
      quantity: number
      reservationSessionId: string
    }>,
  ) {}
}
