/**
 * Order → webhook bridge.
 *
 * Listens to the existing ORDER_EVENTS.* from the orders module and
 * fans them out to n8n / Zapier / custom endpoints via the webhook
 * dispatcher.
 *
 * HARD RULES:
 *   - This listener must NEVER crash the emitter. All handlers use
 *     `{ async: true }` (EventEmitter2 swallows rejected promises) AND
 *     an inner try/catch as defense-in-depth.
 *   - No writes to the DB. Read-only.
 *   - No calls into other services. Only PrismaService + WebhookDispatcherService.
 *
 * If a DB query fails, we log a warning and bail — there is no webhook.
 * Better to miss one event than to take down an order checkout.
 */
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OnEvent } from '@nestjs/event-emitter'
import { PrismaService } from '../../../prisma/prisma.service'
import { WebhookDispatcherService } from '../webhook-dispatcher.service'
import {
  ORDER_EVENTS,
  type OrderCreatedEvent,
  type OrderConfirmedEvent,
  type OrderCancelledEvent,
  type OrderStatusChangedEvent,
} from '../../orders/events/order.events'
import type {
  OrderCreatedPayload,
  OrderConfirmedPayload,
  OrderStatusChangedPayload,
  OrderCancelledPayload,
  OrderShippedPayload,
  OrderDeliveredPayload,
  CustomerSnapshot,
  AddressSnapshot,
  OrderItemSnapshot,
  MoneyAmount,
} from '../events'

// ── Helpers ──────────────────────────────────────────────────

function money(amount: number | string | { toString(): string }): MoneyAmount {
  const n = typeof amount === 'number' ? amount : Number(amount.toString())
  return { amount: n.toFixed(2), currency: 'EUR' }
}

function detectLocale(raw: string | null | undefined): 'de' | 'en' | 'ar' {
  if (raw === 'en' || raw === 'ar' || raw === 'de') return raw
  return 'de'
}

/** Parse order.notes (stored as JSON in a string column for some orders) */
function parseNotes(notes: unknown): Record<string, any> {
  if (!notes || typeof notes !== 'string') return {}
  try {
    return JSON.parse(notes) ?? {}
  } catch {
    return {}
  }
}

// ── Listener ─────────────────────────────────────────────────

@Injectable()
export class OrderWebhookListener {
  private readonly logger = new Logger(OrderWebhookListener.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: WebhookDispatcherService,
    private readonly config: ConfigService,
  ) {}

  // ── Order.created ──────────────────────────────────────────

  @OnEvent(ORDER_EVENTS.CREATED, { async: true })
  async handleCreated(event: OrderCreatedEvent): Promise<void> {
    try {
      const payload = await this.buildOrderCreatedPayload(event.orderId)
      if (!payload) return // already logged
      await this.dispatcher.emit('order.created', payload)
    } catch (err: any) {
      this.logger.warn(`order.created webhook skipped for ${event.orderId}: ${err?.message ?? err}`)
    }
  }

  // ── Order.confirmed ────────────────────────────────────────

  @OnEvent(ORDER_EVENTS.CONFIRMED, { async: true })
  async handleConfirmed(event: OrderConfirmedEvent): Promise<void> {
    try {
      const base = await this.buildOrderCreatedPayload(event.orderId)
      if (!base) return
      const payment = await this.prisma.payment.findUnique({
        where: { orderId: event.orderId },
        select: { id: true, provider: true, method: true, status: true, paidAt: true },
      })
      const payload: OrderConfirmedPayload = {
        ...base,
        paymentMethod: payment?.method ?? base.paymentMethod ?? 'unknown',
        paymentProvider: payment?.provider ?? 'unknown',
        paymentId: payment?.id ?? '',
        confirmedAt: payment?.paidAt?.toISOString() ?? new Date().toISOString(),
      }
      await this.dispatcher.emit('order.confirmed', payload)
    } catch (err: any) {
      this.logger.warn(`order.confirmed webhook skipped for ${event.orderId}: ${err?.message ?? err}`)
    }
  }

  // ── Order.status_changed + shipped/delivered derivations ──

  @OnEvent(ORDER_EVENTS.STATUS_CHANGED, { async: true })
  async handleStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: event.orderId },
        select: { orderNumber: true },
      })
      if (!order) return

      // Always emit the generic status-changed event.
      const generic: OrderStatusChangedPayload = {
        orderId: event.orderId,
        orderNumber: order.orderNumber,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        source: event.source,
        changedAt: new Date().toISOString(),
        orderUrl: this.buildOrderAdminUrl(event.orderId),
      }
      await this.dispatcher.emit('order.status_changed', generic)

      // Derived events — shipped & delivered carry carrier/tracking info.
      if (event.toStatus === 'shipped') {
        await this.emitShipped(event.orderId, order.orderNumber)
      } else if (event.toStatus === 'delivered') {
        await this.emitDelivered(event.orderId, order.orderNumber)
      }
    } catch (err: any) {
      this.logger.warn(
        `order.status_changed webhook skipped for ${event.orderId}: ${err?.message ?? err}`,
      )
    }
  }

  private async emitShipped(orderId: string, orderNumber: string): Promise<void> {
    try {
      const shipment = await this.prisma.shipment.findUnique({
        where: { orderId },
        select: { carrier: true, trackingNumber: true, trackingUrl: true, labelUrl: true, shippedAt: true },
      })
      const payload: OrderShippedPayload = {
        orderId,
        orderNumber,
        carrier: shipment?.carrier ?? 'DHL',
        trackingNumber: shipment?.trackingNumber ?? '',
        trackingUrl: shipment?.trackingUrl ?? '',
        labelUrl: shipment?.labelUrl ?? null,
        shippedAt: shipment?.shippedAt?.toISOString() ?? new Date().toISOString(),
      }
      await this.dispatcher.emit('order.shipped', payload)
    } catch (err: any) {
      this.logger.warn(`order.shipped webhook skipped for ${orderId}: ${err?.message ?? err}`)
    }
  }

  private async emitDelivered(orderId: string, orderNumber: string): Promise<void> {
    try {
      const shipment = await this.prisma.shipment.findUnique({
        where: { orderId },
        select: { carrier: true, trackingNumber: true, deliveredAt: true },
      })
      const payload: OrderDeliveredPayload = {
        orderId,
        orderNumber,
        carrier: shipment?.carrier ?? 'DHL',
        trackingNumber: shipment?.trackingNumber ?? '',
        deliveredAt: shipment?.deliveredAt?.toISOString() ?? new Date().toISOString(),
      }
      await this.dispatcher.emit('order.delivered', payload)
    } catch (err: any) {
      this.logger.warn(`order.delivered webhook skipped for ${orderId}: ${err?.message ?? err}`)
    }
  }

  // ── Order.cancelled ────────────────────────────────────────

  @OnEvent(ORDER_EVENTS.CANCELLED, { async: true })
  async handleCancelled(event: OrderCancelledEvent): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: event.orderId },
        select: {
          orderNumber: true,
          totalAmount: true,
          cancelledAt: true,
          items: { select: { id: true, quantity: true } },
          payment: { select: { amount: true, status: true } },
          returns: { select: { id: true, refundAmount: true } },
        },
      })
      if (!order) return

      // Refund amount: prefer the sum of completed refunds, else the full order total
      // when the payment was captured. Null means "no refund needed / unpaid".
      const hasPaid = order.payment?.status === 'captured' || order.payment?.status === 'partially_refunded' || order.payment?.status === 'refunded'
      const refundAmount = hasPaid ? money(order.totalAmount) : null

      const itemsTotal = order.items.reduce((s, i) => s + i.quantity, 0)

      const payload: OrderCancelledPayload = {
        orderId: event.orderId,
        orderNumber: order.orderNumber,
        reason: event.reason ?? 'unspecified',
        refundAmount,
        itemsCancelled: itemsTotal,
        itemsTotal,
        cancelledAt: order.cancelledAt?.toISOString() ?? new Date().toISOString(),
        orderUrl: this.buildOrderAdminUrl(event.orderId),
      }
      await this.dispatcher.emit('order.cancelled', payload)
    } catch (err: any) {
      this.logger.warn(`order.cancelled webhook skipped for ${event.orderId}: ${err?.message ?? err}`)
    }
  }

  // ── Shared builder: full OrderCreated payload ─────────────

  private async buildOrderCreatedPayload(orderId: string): Promise<OrderCreatedPayload | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true, preferredLang: true, passwordHash: true } },
        shippingAddress: true,
        items: {
          include: {
            variant: {
              select: {
                id: true, sku: true, color: true, size: true,
                product: { select: { slug: true, images: { select: { url: true }, orderBy: { sortOrder: 'asc' }, take: 1 } } },
              },
            },
          },
        },
        payment: { select: { method: true, provider: true } },
      },
    })
    if (!order) {
      this.logger.warn(`Order ${orderId} not found when building webhook payload`)
      return null
    }

    const notes = parseNotes(order.notes)
    const locale = detectLocale(order.user?.preferredLang ?? notes.locale)

    const customer: CustomerSnapshot = {
      id: order.user?.id ?? null,
      email: order.user?.email ?? order.guestEmail ?? '',
      firstName: order.user?.firstName ?? '',
      lastName: order.user?.lastName ?? '',
      locale,
      // stub users have null passwordHash — those are effectively guests
      isGuest: !order.user?.passwordHash,
    }

    const shippingAddress = buildAddressSnapshot(order.shippingAddress, order.shippingAddressSnapshot)
    if (!shippingAddress) {
      this.logger.warn(`Order ${orderId} has no shipping address — webhook skipped`)
      return null
    }

    const items: OrderItemSnapshot[] = order.items.map((item) => ({
      variantId: item.variantId,
      sku: item.snapshotSku,
      productName: item.snapshotName,
      productSlug: item.variant?.product?.slug ?? '',
      color: item.variant?.color ?? null,
      size: item.variant?.size ?? null,
      quantity: item.quantity,
      unitPrice: money(item.unitPrice),
      lineTotal: money(item.totalPrice),
      imageUrl: item.variant?.product?.images?.[0]?.url ?? null,
    }))

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      channel: order.channel,
      customer,
      items,
      subtotal: money(order.subtotal),
      shipping: money(order.shippingCost),
      discount: money(order.discountAmount),
      total: money(order.totalAmount),
      taxIncluded: money(order.taxAmount),
      shippingAddress,
      billingAddress: null, // billing == shipping in this system
      paymentMethod: order.payment?.method ?? null,
      createdAt: order.createdAt.toISOString(),
      orderUrl: this.buildOrderAdminUrl(order.id),
    }
  }

  private buildOrderAdminUrl(orderId: string): string {
    const appUrl = this.config.get<string>('APP_URL', 'https://malak-bekleidung.com')
    return `${appUrl}/de/admin/orders/${orderId}`
  }
}

// ── Address snapshot helper (stand-alone for unit testability) ──

function buildAddressSnapshot(
  relation: any,
  snapshot: any,
): AddressSnapshot | null {
  const src = relation ?? snapshot
  if (!src) return null
  return {
    firstName: src.firstName ?? src.first_name ?? '',
    lastName: src.lastName ?? src.last_name ?? '',
    street: src.street ?? '',
    houseNumber: src.houseNumber ?? src.house_number ?? null,
    postalCode: src.postalCode ?? src.postal_code ?? '',
    city: src.city ?? '',
    country: src.country ?? 'DE',
    phone: src.phone ?? null,
  }
}
