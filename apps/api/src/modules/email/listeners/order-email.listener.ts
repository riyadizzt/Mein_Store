import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { PrismaService } from '../../../prisma/prisma.service'
import { EmailService } from '../email.service'
import {
  ORDER_EVENTS,
  OrderCreatedEvent,
  OrderStatusChangedEvent,
  OrderCancelledEvent,
} from '../../orders/events/order.events'

const STATUS_LABELS: Record<string, Record<string, string>> = {
  confirmed:  { de: 'Bestätigt', en: 'Confirmed', ar: 'مؤكد' },
  processing: { de: 'In Bearbeitung', en: 'Processing', ar: 'قيد المعالجة' },
  shipped:    { de: 'Versendet', en: 'Shipped', ar: 'تم الشحن' },
  delivered:  { de: 'Zugestellt', en: 'Delivered', ar: 'تم التسليم' },
  returned:   { de: 'Retour', en: 'Returned', ar: 'مُرتجع' },
  refunded:   { de: 'Erstattet', en: 'Refunded', ar: 'مُسترد' },
}

/**
 * Extract email + name + language from an order (registered user OR guest).
 *
 * Language resolution priority:
 *   1. order.notes.locale  — the session language at checkout time
 *   2. user.preferredLang  — the profile language (only if notes has none)
 *   3. 'de'                — hard default
 *
 * Why checkout-time wins: since 14.04.2026 Bug-Hunt 2B every order has
 * a linked user (real or stub). Stub users keep the preferredLang from
 * their very first checkout frozen forever — so a customer who made
 * a first purchase in German and then shops in Arabic would always get
 * German emails unless we consult the notes.locale. The reverse is
 * also true: a customer who changes their mind mid-session and switches
 * the site to German gets the confirmation in the language they were
 * actually looking at.
 */
function getRecipient(order: any): { email: string; firstName: string; lang: string } | null {
  let notesLocale: string | null = null
  let notesFirstName: string | null = null
  try {
    const n = JSON.parse(order.notes ?? '{}')
    notesLocale = typeof n.locale === 'string' ? n.locale : null
    notesFirstName = typeof n.guestFirstName === 'string' ? n.guestFirstName : null
  } catch {}

  if (order.user?.email) {
    return {
      email: order.user.email,
      firstName: order.user.firstName,
      lang: notesLocale ?? order.user.preferredLang ?? 'de',
    }
  }
  // Legacy guest path (pre Bug-Hunt 2B): only hit for historical orders
  // without a linked user. New orders always take the branch above.
  const email = order.guestEmail
  if (!email) return null
  return {
    email,
    firstName: notesFirstName ?? 'Kunde',
    lang: notesLocale ?? 'de',
  }
}

@Injectable()
export class OrderEmailListener {
  private readonly logger = new Logger(OrderEmailListener.name)

  constructor(
    private readonly emailService: EmailService,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent(ORDER_EVENTS.CREATED, { async: true })
  async handleOrderCreated(event: OrderCreatedEvent): Promise<void> {
    try {
      const order = await this.prisma.order.findFirst({
        where: { id: event.orderId },
        include: {
          user: { select: { email: true, firstName: true, preferredLang: true } },
          items: {
            include: {
              variant: {
                select: {
                  sku: true, color: true, size: true,
                  product: { select: { translations: { select: { language: true, name: true } } } },
                },
              },
            },
          },
          shippingAddress: {
            select: { firstName: true, lastName: true, street: true, houseNumber: true, city: true, postalCode: true, country: true },
          },
        },
      })

      const recipient = getRecipient(order)
      if (!recipient) return

      const items = (order?.items ?? []).map((item: any) => {
        const name = item.variant?.product?.translations?.find((t: any) => t.language === recipient.lang)?.name
          ?? item.variant?.product?.translations?.[0]?.name
          ?? item.snapshotName
        return {
          name, sku: item.snapshotSku, color: item.variant?.color, size: item.variant?.size,
          quantity: item.quantity, unitPrice: Number(item.unitPrice).toFixed(2), totalPrice: Number(item.totalPrice).toFixed(2),
        }
      })

      await this.emailService.queueOrderConfirmation(recipient.email, recipient.lang, {
        firstName: recipient.firstName,
        orderNumber: order!.orderNumber,
        orderDate: order!.createdAt.toLocaleDateString(recipient.lang === 'de' ? 'de-DE' : 'en-GB'),
        items,
        subtotal: Number(order!.subtotal).toFixed(2),
        shippingCost: Number(order!.shippingCost).toFixed(2),
        taxAmount: Number(order!.taxAmount).toFixed(2),
        total: Number(order!.totalAmount).toFixed(2),
        currency: order!.currency,
        shippingAddress: order!.shippingAddress,
        appUrl: process.env.APP_URL || 'https://malak-bekleidung.com',
      })

      this.logger.log(`Order confirmation email queued for ${recipient.email} (${order!.orderNumber})`)
    } catch (err) {
      this.logger.error(`Failed to queue order confirmation email for ${event.orderId}`, err)
    }
  }

  @OnEvent(ORDER_EVENTS.STATUS_CHANGED)
  async handleStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
    try {
      const order = await this.prisma.order.findFirst({
        where: { id: event.orderId },
        include: {
          user: {
            select: {
              email: true, firstName: true, preferredLang: true, passwordHash: true,
              // isVerified + oauthAccounts let us distinguish Google/Facebook
              // users (who legitimately have no passwordHash) from real
              // stub-guests. A Google user has an oauthAccounts entry (post
              // 14.04.2026 fix) OR is marked isVerified (legacy pre-14.04
              // social login). Only real stub-guests fail ALL three checks.
              isVerified: true,
              oauthAccounts: { select: { id: true }, take: 1 },
            },
          },
          shipment: { select: { trackingNumber: true, trackingUrl: true, carrier: true } },
          items: {
            select: {
              snapshotName: true, snapshotSku: true, quantity: true, unitPrice: true, totalPrice: true,
              variant: {
                select: {
                  color: true,
                  size: true,
                  product: { select: { excludeFromReturns: true } },
                },
              },
            },
          },
          shippingAddress: { select: { firstName: true, lastName: true, street: true, houseNumber: true, postalCode: true, city: true } },
        },
      })

      const recipient = getRecipient(order)
      if (!recipient) return

      // Guest invite email — fires when the order is first confirmed.
      //
      // Detection: a "stub-guest" is a User with NO passwordHash AND
      // NO OAuth link AND NOT marked as verified. The previous check
      // only looked at `!passwordHash` which accidentally matched
      // Google/Facebook users too (they legitimately have no
      // passwordHash) → they received a bogus "create your account"
      // email even though they were already logged in via OAuth.
      //
      // The 3-signal check matches the one in admin-users.service.ts:218
      // so both the admin customer list and this listener agree on who
      // is a real guest.
      const u = order?.user
      const isStubGuest = !!u && !u.passwordHash && (u.oauthAccounts?.length ?? 0) === 0 && !u.isVerified && !!u.email
      const isPureGuest = !order?.userId && !!order?.guestEmail
      if (event.toStatus === 'confirmed' && (isStubGuest || isPureGuest)) {
        try {
          const notes = JSON.parse(order!.notes ?? '{}')
          const inviteEmail = order!.user?.email ?? order!.guestEmail
          if (notes.inviteToken && inviteEmail) {
            await this.emailService.queueGuestInvite(recipient.email, recipient.lang, {
              firstName: recipient.firstName,
              orderNumber: order!.orderNumber,
              email: inviteEmail,
              inviteToken: notes.inviteToken,
              appUrl: process.env.APP_URL || 'https://malak-bekleidung.com',
            })
            this.logger.log(`Guest invite email queued for ${inviteEmail} (${order!.orderNumber})`)
          }
        } catch (err) {
          this.logger.error(`Failed to send guest invite for ${event.orderId}`, err)
        }
      }

      // Status-Update email — ONLY for admin-initiated status changes
      // Skip confirmed/processing (these happen automatically, customer already got confirmation email)
      const manualStatuses = ['shipped', 'delivered', 'returned', 'refunded']
      if (!manualStatuses.includes(event.toStatus)) return

      const statusLabel = STATUS_LABELS[event.toStatus]?.[recipient.lang] ?? event.toStatus
      const items = (order!.items ?? []).map((item: any) => ({
        name: item.snapshotName, sku: item.snapshotSku, color: item.variant?.color, size: item.variant?.size,
        quantity: item.quantity, totalPrice: Number(item.totalPrice).toFixed(2),
      }))

      // ── Return button eligibility ─────────────────────────
      //
      // The CTA only appears when ALL of these are true:
      //   1. Status is 'delivered' (only useful window)
      //   2. Global ShopSettings.returnsEnabled is ON (admin kill switch)
      //   3. Order has at least one product that is NOT excludeFromReturns
      //      (otherwise the Return page would reject every item anyway)
      //   4. notes.confirmationToken is present (public-token auth)
      //
      // This mirrors exactly what the customer-facing order detail page
      // does for registered customers, so guest and logged-in customers
      // see the same policy. Admin controls the button via the existing
      // toggle in /admin/settings → "Retouren-System".
      let returnUrl: string | null = null
      let returnEligible = false
      if (event.toStatus === 'delivered') {
        try {
          // 1. Global toggle
          const setting = await this.prisma.shopSetting.findUnique({
            where: { key: 'returnsEnabled' },
          })
          const returnsGloballyOn = setting?.value !== 'false' // default: on

          // 2. At least one returnable item
          const hasReturnableItem = (order!.items ?? []).some(
            (it: any) => it.variant?.product?.excludeFromReturns !== true,
          )

          // 3. Token present
          let token: string | null = null
          try {
            const notes = JSON.parse((order as any)!.notes ?? '{}')
            token = notes.confirmationToken ?? null
          } catch {}

          if (returnsGloballyOn && hasReturnableItem && token) {
            const appUrl = process.env.APP_URL || 'https://malak-bekleidung.com'
            returnUrl = `${appUrl}/${recipient.lang}/return/${order!.id}?token=${token}`
            returnEligible = true
          } else {
            this.logger.debug(
              `[order-email] Return CTA hidden for ${order!.orderNumber}: ` +
              `globallyOn=${returnsGloballyOn} hasReturnable=${hasReturnableItem} hasToken=${!!token}`,
            )
          }
        } catch (err) {
          this.logger.warn(
            `[order-email] Return eligibility check failed for ${event.orderId}: ${(err as Error).message}`,
          )
        }
      }

      await this.emailService.queueOrderStatus(recipient.email, recipient.lang, {
        firstName: recipient.firstName,
        orderNumber: order!.orderNumber,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        statusLabel,
        trackingNumber: order!.shipment?.trackingNumber,
        trackingUrl: order!.shipment?.trackingUrl,
        carrier: order!.shipment?.carrier,
        items,
        total: Number(order!.totalAmount).toFixed(2),
        shippingAddress: order!.shippingAddress,
        isShipped: event.toStatus === 'shipped',
        isDelivered: event.toStatus === 'delivered',
        returnUrl,
        returnEligible,
        appUrl: process.env.APP_URL || 'https://malak-bekleidung.com',
      })
    } catch (err) {
      this.logger.error(`Failed to queue status email for ${event.orderId}`, err)
    }
  }

  @OnEvent(ORDER_EVENTS.CANCELLED)
  async handleOrderCancelled(event: OrderCancelledEvent): Promise<void> {
    try {
      const order = await this.prisma.order.findFirst({
        where: { id: event.orderId },
        include: { user: { select: { email: true, firstName: true, preferredLang: true } } },
      })

      const recipient = getRecipient(order)
      if (!recipient) return

      await this.emailService.queueOrderCancellation(recipient.email, recipient.lang, {
        firstName: recipient.firstName,
        orderNumber: order!.orderNumber,
        reason: event.reason,
      })
    } catch (err) {
      this.logger.error(`Failed to queue cancellation email for ${event.orderId}`, err)
    }
  }
}
