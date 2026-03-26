// ── Event Name Constants ──────────────────────────────────────

export const ORDER_EVENTS = {
  // Hauptfluss
  CREATED: 'order.created',
  CONFIRMED: 'order.confirmed',
  CANCELLED: 'order.cancelled',
  STATUS_CHANGED: 'order.status_changed',

  // Inventory-Integration (sync via emitAsync)
  STOCK_RESERVE: 'order.stock.reserve',
  STOCK_RELEASE: 'order.stock.release',
  STOCK_CONFIRM: 'order.stock.confirm',
} as const

// ── Event Payload Classes ─────────────────────────────────────

export class OrderCreatedEvent {
  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly correlationId: string,
    public readonly items: Array<{
      variantId: string
      warehouseId: string
      quantity: number
      reservationSessionId: string
    }>,
  ) {}
}

export class OrderConfirmedEvent {
  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly correlationId: string,
    public readonly reservationIds: string[],
  ) {}
}

export class OrderCancelledEvent {
  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly correlationId: string,
    public readonly reason: string,
    public readonly reservationIds: string[],
  ) {}
}

export class OrderStatusChangedEvent {
  constructor(
    public readonly orderId: string,
    public readonly fromStatus: string,
    public readonly toStatus: string,
    public readonly source: string,
    public readonly correlationId: string,
  ) {}
}
