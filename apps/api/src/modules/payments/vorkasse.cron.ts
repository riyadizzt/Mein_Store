import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../../prisma/prisma.service'
// EmailService available via module if needed for template emails
import { EventEmitter2 } from '@nestjs/event-emitter'
import { VorkasseProvider } from './providers/vorkasse.provider'

/**
 * Vorkasse (Bank Transfer) Cron Job
 *
 * Runs every hour:
 * 1. After X days (default 7): Send payment reminder email
 * 2. After Y days (default 10): Auto-cancel order + release stock
 */
@Injectable()
export class VorkasseCron {
  private readonly logger = new Logger(VorkasseCron.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly vorkasseProvider: VorkasseProvider,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleVorkasseDeadlines() {
    const config = await this.vorkasseProvider.getBankDetails()
    if (!config.enabled) return

    const now = new Date()

    // Find all Vorkasse orders that are still pending payment
    const pendingOrders = await this.prisma.order.findMany({
      where: {
        status: { in: ['pending', 'pending_payment'] },
        payment: { provider: 'VORKASSE', status: 'pending' },
        deletedAt: null,
      },
      include: {
        user: { select: { email: true, firstName: true, preferredLang: true } },
        payment: true,
      },
    })

    for (const order of pendingOrders) {
      const createdAt = new Date(order.createdAt)
      const daysSinceOrder = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)

      const email = order.user?.email ?? order.guestEmail
      if (!email) continue

      // Auto-cancel after cancelDays (default 10)
      if (daysSinceOrder >= config.cancelDays) {
        await this.cancelVorkasseOrder(order, email)
        continue
      }

      // Send reminder after reminderDays (default 7)
      if (daysSinceOrder >= config.reminderDays) {
        // Check if reminder was already sent (stored in payment metadata)
        const reminderSent = (order.payment?.metadata as any)?.reminderSent
        if (!reminderSent) {
          await this.sendPaymentReminder(order, email, config)
        }
      }
    }
  }

  private async sendPaymentReminder(order: any, email: string, config: any) {
    const lang = order.user?.preferredLang ?? 'de'

    try {
      // Send reminder email via Resend directly
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.EMAIL_FROM_NOREPLY || 'noreply@malak-bekleidung.com'
      const daysLeft = config.cancelDays - config.reminderDays

      const subjects: Record<string, string> = {
        de: `Zahlungserinnerung — Bestellung ${order.orderNumber}`,
        en: `Payment Reminder — Order ${order.orderNumber}`,
        ar: `تذكير بالدفع — طلب ${order.orderNumber}`,
      }

      const bodies: Record<string, string> = {
        de: `Wir haben noch keine Zahlung für deine Bestellung ${order.orderNumber} erhalten. Bitte überweise den Betrag von €${Number(order.totalAmount).toFixed(2)} innerhalb von ${daysLeft} Tagen. Verwendungszweck: ${order.orderNumber}`,
        en: `We have not yet received payment for your order ${order.orderNumber}. Please transfer €${Number(order.totalAmount).toFixed(2)} within ${daysLeft} days. Reference: ${order.orderNumber}`,
        ar: `لم نستلم بعد الدفع للطلب ${order.orderNumber}. يرجى تحويل مبلغ €${Number(order.totalAmount).toFixed(2)} خلال ${daysLeft} أيام. المرجع: ${order.orderNumber}`,
      }

      await resend.emails.send({
        from,
        to: email,
        subject: subjects[lang] ?? subjects.de,
        html: `<div style="font-family:Arial;max-width:600px;margin:0 auto;padding:20px;${lang === 'ar' ? 'direction:rtl;text-align:right' : ''}">
          <h2>${subjects[lang] ?? subjects.de}</h2>
          <p>${bodies[lang] ?? bodies.de}</p>
          <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0" dir="ltr">
            <p><strong>IBAN:</strong> ${config.iban}</p>
            <p><strong>BIC:</strong> ${config.bic}</p>
            <p><strong>Bank:</strong> ${config.bankName}</p>
            <p><strong>${lang === 'ar' ? 'المرجع' : 'Verwendungszweck'}:</strong> ${order.orderNumber}</p>
            <p><strong>${lang === 'ar' ? 'المبلغ' : 'Betrag'}:</strong> €${Number(order.totalAmount).toFixed(2)}</p>
          </div>
        </div>`,
      })

      // Mark reminder as sent
      await this.prisma.payment.update({
        where: { orderId: order.id },
        data: { metadata: { ...(order.payment?.metadata as any ?? {}), reminderSent: true, reminderSentAt: new Date().toISOString() } },
      })

      this.logger.log(`Vorkasse reminder sent: ${order.orderNumber} → ${email}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(`Failed to send Vorkasse reminder for ${order.orderNumber}: ${msg}`)
    }
  }

  private async cancelVorkasseOrder(order: any, _email: string) {
    try {
      // Cancel order
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'cancelled' },
      })

      // Update payment status
      await this.prisma.payment.update({
        where: { orderId: order.id },
        data: { status: 'failed', failureReason: 'Vorkasse: Zahlungsfrist abgelaufen' },
      })

      // Release stock reservations
      const reservations = await this.prisma.stockReservation.findMany({
        where: { orderId: order.id, status: 'RESERVED' },
      })
      for (const res of reservations) {
        await this.prisma.stockReservation.update({
          where: { id: res.id },
          data: { status: 'RELEASED' },
        })
        await this.prisma.inventory.updateMany({
          where: { variantId: res.variantId },
          data: { quantityReserved: { decrement: res.quantity } },
        })
      }

      // Emit cancellation event
      this.eventEmitter.emit('order.status_changed', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        from: 'pending_payment',
        to: 'cancelled',
        reason: 'Vorkasse: Zahlungsfrist abgelaufen',
      })

      // Create status history
      await this.prisma.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: order.status,
          toStatus: 'cancelled',
          source: 'system',
          notes: 'Vorkasse: Zahlungsfrist abgelaufen (automatisch)',
        },
      })

      this.logger.log(`Vorkasse auto-cancelled: ${order.orderNumber} (no payment after ${order.payment?.metadata ? 'deadline' : '10'} days)`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(`Failed to auto-cancel Vorkasse order ${order.orderNumber}: ${msg}`)
    }
  }
}
