import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { PrismaService } from '../../../prisma/prisma.service'
import { NotificationService } from '../services/notification.service'

interface OrderCreatedEvent {
  orderId: string
  orderNumber: string
  correlationId?: string
}

interface OrderStatusChangedEvent {
  orderId: string
  fromStatus: string
  toStatus: string
  changedBy?: string
  correlationId?: string
}

interface ReturnSubmittedEvent {
  returnId: string
  orderId: string
  orderNumber: string
  reason?: string
  correlationId?: string
}

interface PaymentFailedEvent {
  paymentId: string
  orderId: string
  orderNumber: string
  amount?: number
  reason?: string
  correlationId?: string
}

interface UserRegisteredEvent {
  userId: string
  email: string
  firstName: string
  lastName: string
  correlationId?: string
}

const TRILINGUAL = {
  new_order: {
    de: (orderNumber: string) => `Neue Bestellung #${orderNumber}`,
    en: (orderNumber: string) => `New Order #${orderNumber}`,
    ar: (orderNumber: string) => `طلب جديد #${orderNumber}`,
  },
  order_confirmed: {
    de: (orderNumber: string) => `Bestellung #${orderNumber} bestätigt`,
    en: (orderNumber: string) => `Order #${orderNumber} confirmed`,
    ar: (orderNumber: string) => `تم تأكيد الطلب #${orderNumber}`,
  },
  order_shipped: {
    de: (orderNumber: string) => `Bestellung #${orderNumber} versendet`,
    en: (orderNumber: string) => `Order #${orderNumber} shipped`,
    ar: (orderNumber: string) => `تم شحن الطلب #${orderNumber}`,
  },
  order_delivered: {
    de: (orderNumber: string) => `Bestellung #${orderNumber} zugestellt`,
    en: (orderNumber: string) => `Order #${orderNumber} delivered`,
    ar: (orderNumber: string) => `تم تسليم الطلب #${orderNumber}`,
  },
  order_cancelled: {
    de: (orderNumber: string) => `Bestellung #${orderNumber} storniert`,
    en: (orderNumber: string) => `Order #${orderNumber} cancelled`,
    ar: (orderNumber: string) => `تم إلغاء الطلب #${orderNumber}`,
  },
  return_submitted: {
    de: (orderNumber: string) => `Retoure für Bestellung #${orderNumber}`,
    en: (orderNumber: string) => `Return for Order #${orderNumber}`,
    ar: (orderNumber: string) => `إرجاع للطلب #${orderNumber}`,
  },
  payment_failed: {
    de: (orderNumber: string) => `Zahlung fehlgeschlagen für #${orderNumber}`,
    en: (orderNumber: string) => `Payment failed for #${orderNumber}`,
    ar: (orderNumber: string) => `فشل الدفع للطلب #${orderNumber}`,
  },
  customer_registered: {
    de: (name: string) => `Neuer Kunde: ${name}`,
    en: (name: string) => `New Customer: ${name}`,
    ar: (name: string) => `عميل جديد: ${name}`,
  },
} as const

type Language = 'de' | 'en' | 'ar'

function t(
  key: keyof typeof TRILINGUAL,
  lang: Language,
  param: string,
): string {
  const translations = TRILINGUAL[key]
  const fn = translations[lang] ?? translations.de
  return fn(param)
}

@Injectable()
export class NotificationListener {
  private readonly logger = new Logger(NotificationListener.name)

  constructor(
    private readonly notificationService: NotificationService,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent('order.created')
  async handleOrderCreated(event: OrderCreatedEvent) {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: event.orderId },
        include: { user: { select: { firstName: true, lastName: true } } },
      })

      if (!order) {
        this.logger.warn(`Order not found for notification: ${event.orderId}`)
        return
      }

      const customerName = order.user
        ? `${order.user.firstName} ${order.user.lastName}`
        : order.guestEmail ?? 'Gast'

      const amount = Number(order.totalAmount)

      await this.notificationService.createForAllAdmins({
        type: 'new_order',
        title: t('new_order', 'de', event.orderNumber),
        body: `\u20AC${amount.toFixed(2)} von ${customerName}`,
        entityType: 'order',
        entityId: event.orderId,
        data: {
          orderNumber: event.orderNumber,
          amount,
          customerName,
          correlationId: event.correlationId,
        },
      })
    } catch (error: any) {
      this.logger.error(
        `Failed to create notification for order.created: ${error.message}`,
        error.stack,
      )
    }
  }

  @OnEvent('order.status_changed')
  async handleOrderStatusChanged(event: OrderStatusChangedEvent) {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: event.orderId },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              preferredLang: true,
            },
          },
        },
      })

      if (!order) {
        this.logger.warn(
          `Order not found for status_changed notification: ${event.orderId}`,
        )
        return
      }

      const customerStatuses = ['confirmed', 'shipped', 'delivered']
      if (customerStatuses.includes(event.toStatus) && order.user) {
        const lang = (order.user.preferredLang as Language) ?? 'de'
        const typeKey = `order_${event.toStatus}` as keyof typeof TRILINGUAL

        const bodyMap: Record<string, Record<Language, string>> = {
          confirmed: {
            de: `Ihre Bestellung #${order.orderNumber} wurde bestätigt.`,
            en: `Your order #${order.orderNumber} has been confirmed.`,
            ar: `\u062A\u0645 \u062A\u0623\u0643\u064A\u062F \u0637\u0644\u0628\u0643 #${order.orderNumber}.`,
          },
          shipped: {
            de: `Ihre Bestellung #${order.orderNumber} wurde versendet.`,
            en: `Your order #${order.orderNumber} has been shipped.`,
            ar: `\u062A\u0645 \u0634\u062D\u0646 \u0637\u0644\u0628\u0643 #${order.orderNumber}.`,
          },
          delivered: {
            de: `Ihre Bestellung #${order.orderNumber} wurde zugestellt.`,
            en: `Your order #${order.orderNumber} has been delivered.`,
            ar: `\u062A\u0645 \u062A\u0633\u0644\u064A\u0645 \u0637\u0644\u0628\u0643 #${order.orderNumber}.`,
          },
        }

        await this.notificationService.create({
          userId: order.user.id,
          type: typeKey,
          title: t(typeKey, lang, order.orderNumber),
          body: bodyMap[event.toStatus][lang],
          entityType: 'order',
          entityId: event.orderId,
          channel: 'customer',
          data: {
            orderNumber: order.orderNumber,
            fromStatus: event.fromStatus,
            toStatus: event.toStatus,
            correlationId: event.correlationId,
          },
        })
      }

      if (event.toStatus === 'cancelled') {
        const customerName = order.user
          ? `${order.user.firstName} ${order.user.lastName}`
          : order.guestEmail ?? 'Gast'

        await this.notificationService.createForAllAdmins({
          type: 'order_cancelled',
          title: t('order_cancelled', 'de', order.orderNumber),
          body: `Bestellung #${order.orderNumber} von ${customerName} wurde storniert.`,
          entityType: 'order',
          entityId: event.orderId,
          data: {
            orderNumber: order.orderNumber,
            fromStatus: event.fromStatus,
            toStatus: event.toStatus,
            changedBy: event.changedBy,
            correlationId: event.correlationId,
          },
        })
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to create notification for order.status_changed: ${error.message}`,
        error.stack,
      )
    }
  }

  @OnEvent('invoice.generated')
  handleInvoiceGenerated() {
    // Skip: already handled by email notifications
  }

  @OnEvent('return.submitted')
  async handleReturnSubmitted(event: ReturnSubmittedEvent) {
    try {
      await this.notificationService.createForAllAdmins({
        type: 'return_submitted',
        title: t('return_submitted', 'de', event.orderNumber),
        body: `Eine Retoure wurde für Bestellung #${event.orderNumber} eingereicht.${event.reason ? ` Grund: ${event.reason}` : ''}`,
        entityType: 'return',
        entityId: event.returnId,
        data: {
          returnId: event.returnId,
          orderId: event.orderId,
          orderNumber: event.orderNumber,
          reason: event.reason,
          correlationId: event.correlationId,
        },
      })
    } catch (error: any) {
      this.logger.error(
        `Failed to create notification for return.submitted: ${error.message}`,
        error.stack,
      )
    }
  }

  @OnEvent('payment.failed')
  async handlePaymentFailed(event: PaymentFailedEvent) {
    try {
      await this.notificationService.createForAllAdmins({
        type: 'payment_failed',
        title: t('payment_failed', 'de', event.orderNumber),
        body: `Zahlung${event.amount ? ` (\u20AC${event.amount.toFixed(2)})` : ''} für Bestellung #${event.orderNumber} fehlgeschlagen.${event.reason ? ` Grund: ${event.reason}` : ''}`,
        entityType: 'order',
        entityId: event.orderId,
        data: {
          paymentId: event.paymentId,
          orderId: event.orderId,
          orderNumber: event.orderNumber,
          amount: event.amount,
          reason: event.reason,
          correlationId: event.correlationId,
        },
      })
    } catch (error: any) {
      this.logger.error(
        `Failed to create notification for payment.failed: ${error.message}`,
        error.stack,
      )
    }
  }

  @OnEvent('user.registered')
  async handleUserRegistered(event: UserRegisteredEvent) {
    try {
      const fullName = `${event.firstName} ${event.lastName}`

      await this.notificationService.createForAllAdmins({
        type: 'customer_registered',
        title: t('customer_registered', 'de', fullName),
        body: `${fullName} (${event.email}) hat sich registriert.`,
        entityType: 'user',
        entityId: event.userId,
        data: {
          userId: event.userId,
          email: event.email,
          firstName: event.firstName,
          lastName: event.lastName,
          correlationId: event.correlationId,
        },
      })
    } catch (error: any) {
      this.logger.error(
        `Failed to create notification for user.registered: ${error.message}`,
        error.stack,
      )
    }
  }
}
