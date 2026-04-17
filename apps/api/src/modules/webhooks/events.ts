/**
 * Outbound webhook event types (n8n, Zapier, custom endpoints).
 *
 * Each event carries the FULL payload n8n needs — no callbacks to the API
 * required for common automation scenarios (Instagram post, Slack alert,
 * Airtable sync, eBay listing, etc).
 *
 * Envelope follows Stripe's convention: { id, type, created, data: { object } }.
 * Bump WEBHOOK_API_VERSION when breaking the envelope or any payload shape.
 */

export const WEBHOOK_API_VERSION = '2026-04-17'

// ── Event name whitelist (the single source of truth) ────────
// Keep in sync with event payload interfaces below and the admin UI matrix.
export const WEBHOOK_EVENT_TYPES = [
  // Orders (6)
  'order.created',
  'order.confirmed',
  'order.status_changed',
  'order.cancelled',
  'order.shipped',
  'order.delivered',

  // Returns (4)
  'return.requested',
  'return.approved',
  'return.received',
  'return.refunded',

  // Customer / Contact (3)
  'customer.registered',
  'customer.deletion_requested',
  'contact.message_received',

  // Products / Inventory (4)
  'product.created',
  'product.out_of_stock',
  'inventory.low_stock',
  'inventory.restock',

  // Payments (3)
  'payment.failed',
  'payment.disputed',
  'payment.refunded',
] as const

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number]

export function isValidEventType(event: string): event is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(event)
}

// ── Stripe-style envelope ────────────────────────────────────

export interface WebhookEnvelope<T = unknown> {
  id: string // uuid — used as X-Malak-Event-Id for idempotency
  type: WebhookEventType
  created: string // ISO-8601
  apiVersion: string // WEBHOOK_API_VERSION
  data: {
    object: T
  }
}

// ── Payload shapes — designed for NO-CALLBACK automation ─────
// Each payload embeds EVERYTHING n8n typically needs. If you find yourself
// reaching back to the API from n8n, the payload is incomplete — enrich it
// at emit-time in the service, don't make n8n chase references.

export interface MoneyAmount {
  amount: string // "99.99" — already includes 19% German VAT (Bruttopreis)
  currency: 'EUR'
}

export interface AddressSnapshot {
  firstName: string
  lastName: string
  street: string
  houseNumber?: string | null
  postalCode: string
  city: string
  country: string // 'DE', 'AT', etc.
  phone?: string | null
}

export interface OrderItemSnapshot {
  variantId: string
  sku: string
  productName: string // snapshot at order time
  productSlug: string
  color?: string | null
  size?: string | null
  quantity: number
  unitPrice: MoneyAmount
  lineTotal: MoneyAmount
  imageUrl?: string | null
}

export interface CustomerSnapshot {
  id: string | null // null for pure-guest (rare after stub-user refactor)
  email: string
  firstName: string
  lastName: string
  locale: 'de' | 'en' | 'ar'
  isGuest: boolean
}

// ─── Order events ───

export interface OrderCreatedPayload {
  orderId: string
  orderNumber: string
  channel: string // 'website' | 'mobile' | 'pos' | 'facebook' | ...
  customer: CustomerSnapshot
  items: OrderItemSnapshot[]
  subtotal: MoneyAmount
  shipping: MoneyAmount
  discount: MoneyAmount
  total: MoneyAmount
  taxIncluded: MoneyAmount // 19% already baked into total
  shippingAddress: AddressSnapshot
  billingAddress: AddressSnapshot | null
  paymentMethod: string | null // may be null at created stage
  createdAt: string
  orderUrl: string // admin deep link
}

export interface OrderConfirmedPayload extends OrderCreatedPayload {
  paymentMethod: string // always set at confirmed stage
  paymentProvider: string // 'STRIPE' | 'PAYPAL' | 'KLARNA' | 'SUMUP' | 'VORKASSE'
  paymentId: string
  confirmedAt: string
}

export interface OrderStatusChangedPayload {
  orderId: string
  orderNumber: string
  fromStatus: string
  toStatus: string
  source: string // 'admin' | 'webhook' | 'cron' | ...
  changedAt: string
  orderUrl: string
}

export interface OrderCancelledPayload {
  orderId: string
  orderNumber: string
  reason: string
  refundAmount: MoneyAmount | null // null if unpaid
  itemsCancelled: number
  itemsTotal: number
  cancelledAt: string
  orderUrl: string
}

export interface OrderShippedPayload {
  orderId: string
  orderNumber: string
  carrier: string // 'DHL'
  trackingNumber: string
  trackingUrl: string
  labelUrl: string | null
  shippedAt: string
}

export interface OrderDeliveredPayload {
  orderId: string
  orderNumber: string
  carrier: string
  trackingNumber: string
  deliveredAt: string
}

// ─── Return events ───

export interface ReturnItemSnapshot {
  variantId: string
  sku: string
  productName: string
  quantity: number
  reason: string
}

export interface ReturnPayloadBase {
  returnId: string
  returnNumber: string
  orderId: string
  orderNumber: string
  customer: CustomerSnapshot
  items: ReturnItemSnapshot[]
  refundAmount: MoneyAmount
  shopPaysShipping: boolean
  createdAt: string
  returnUrl: string // admin deep link
}

export type ReturnRequestedPayload = ReturnPayloadBase
export type ReturnApprovedPayload = ReturnPayloadBase & { approvedAt: string; labelSent: boolean }
export type ReturnReceivedPayload = ReturnPayloadBase & { receivedAt: string; warehouseId: string }
export type ReturnRefundedPayload = ReturnPayloadBase & { refundedAt: string; paymentProvider: string }

// ─── Customer / Contact events ───

export interface CustomerRegisteredPayload {
  userId: string
  email: string
  firstName: string
  lastName: string
  locale: 'de' | 'en' | 'ar'
  provider: 'password' | 'google' | 'facebook' | 'apple'
  registeredAt: string
}

export interface CustomerDeletionRequestedPayload {
  userId: string
  email: string
  scheduledDeletionAt: string // when GDPR cron will anonymize
  requestedAt: string
}

export interface ContactMessageReceivedPayload {
  messageId: string
  name: string
  email: string
  subject: string
  message: string
  locale: string
  receivedAt: string
  adminUrl: string // deep link to /admin/contact-messages
}

// ─── Products / Inventory events ───
// product.created carries EVERYTHING needed for a social-media post
// with zero API callbacks: all 3 language descriptions, all image URLs,
// brand, category, price, shop URL.

export interface ProductCreatedPayload {
  productId: string
  slug: string
  brand: string
  category: {
    id: string
    slug: string
    nameDe: string | null
    nameEn: string | null
    nameAr: string | null
  } | null
  basePrice: MoneyAmount
  salePrice: MoneyAmount | null
  descriptions: {
    de: { name: string; description: string | null } | null
    en: { name: string; description: string | null } | null
    ar: { name: string; description: string | null } | null
  }
  images: {
    primary: string | null
    all: string[]
  }
  variants: Array<{
    id: string
    sku: string
    color: string | null
    size: string | null
    barcode: string
  }>
  urls: {
    de: string // https://…/de/products/<slug>
    en: string
    ar: string
  }
  createdAt: string
  adminUrl: string
}

export interface ProductOutOfStockPayload {
  productId: string
  productSlug: string
  productName: string
  variantId: string
  sku: string
  color: string | null
  size: string | null
  lastSoldAt: string
}

export interface InventoryLowStockPayload {
  productId: string
  productSlug: string
  productName: string
  variantId: string
  sku: string
  color: string | null
  size: string | null
  warehouseId: string
  warehouseName: string
  quantityOnHand: number
  threshold: number
}

export interface InventoryRestockPayload {
  productId: string
  productSlug: string
  productName: string
  variantId: string
  sku: string
  warehouseId: string
  warehouseName: string
  delta: number // positive number of units added
  newQuantity: number
  supplierId: string | null
  supplierName: string | null
  source: 'intake' | 'manual_correction' | 'return'
  occurredAt: string
}

// ─── Payment events ───

export interface PaymentFailedPayload {
  paymentId: string
  orderId: string
  orderNumber: string
  provider: string
  amount: MoneyAmount
  errorCode: string | null
  errorMessage: string
  failedAt: string
}

export interface PaymentDisputedPayload {
  paymentId: string
  orderId: string
  orderNumber: string
  provider: string
  amount: MoneyAmount
  reason: string
  disputedAt: string
}

export interface PaymentRefundedPayload {
  paymentId: string
  orderId: string
  orderNumber: string
  provider: string
  refundAmount: MoneyAmount
  refundId: string | null
  fullyRefunded: boolean
  refundedAt: string
}

// ── Event → payload map (used for compile-time safety in dispatcher) ──

export type WebhookEventPayloads = {
  'order.created': OrderCreatedPayload
  'order.confirmed': OrderConfirmedPayload
  'order.status_changed': OrderStatusChangedPayload
  'order.cancelled': OrderCancelledPayload
  'order.shipped': OrderShippedPayload
  'order.delivered': OrderDeliveredPayload
  'return.requested': ReturnRequestedPayload
  'return.approved': ReturnApprovedPayload
  'return.received': ReturnReceivedPayload
  'return.refunded': ReturnRefundedPayload
  'customer.registered': CustomerRegisteredPayload
  'customer.deletion_requested': CustomerDeletionRequestedPayload
  'contact.message_received': ContactMessageReceivedPayload
  'product.created': ProductCreatedPayload
  'product.out_of_stock': ProductOutOfStockPayload
  'inventory.low_stock': InventoryLowStockPayload
  'inventory.restock': InventoryRestockPayload
  'payment.failed': PaymentFailedPayload
  'payment.disputed': PaymentDisputedPayload
  'payment.refunded': PaymentRefundedPayload
}
