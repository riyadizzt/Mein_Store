/**
 * All 20 canonical webhook event types — imported by the E2E test so the
 * test subscription receives everything we might emit.
 *
 * Mirror of apps/api/src/modules/webhooks/events.ts WEBHOOK_EVENT_TYPES.
 */
export const ALL_WEBHOOK_EVENTS = [
  'order.created',
  'order.confirmed',
  'order.status_changed',
  'order.cancelled',
  'order.shipped',
  'order.delivered',
  'return.requested',
  'return.approved',
  'return.received',
  'return.refunded',
  'customer.registered',
  'customer.deletion_requested',
  'contact.message_received',
  'product.created',
  'product.out_of_stock',
  'inventory.low_stock',
  'inventory.restock',
  'payment.failed',
  'payment.disputed',
  'payment.refunded',
] as const
