import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../../../prisma/prisma.service'
import { EmailService } from '../../email/email.service'

@Injectable()
export class DailySummaryCron {
  private readonly logger = new Logger(DailySummaryCron.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  @Cron('0 8 * * *') // Every day at 08:00
  async sendDailySummary() {
    // Check if enabled
    const setting = await this.prisma.shopSetting.findUnique({ where: { key: 'notif_daily_summary' } })
    if (setting?.value === 'false') return

    const emailSetting = await this.prisma.shopSetting.findUnique({ where: { key: 'notif_daily_summary_email' } })
    const recipientEmail = emailSetting?.value
    if (!recipientEmail) {
      this.logger.warn('Daily summary email not configured (notif_daily_summary_email)')
      return
    }

    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    yesterday.setHours(0, 0, 0, 0)
    const yesterdayEnd = new Date(yesterday)
    yesterdayEnd.setHours(23, 59, 59, 999)

    const lastWeekSameDay = new Date(yesterday)
    lastWeekSameDay.setDate(lastWeekSameDay.getDate() - 7)
    const lastWeekEnd = new Date(lastWeekSameDay)
    lastWeekEnd.setHours(23, 59, 59, 999)

    const onlineFilter = { channel: { in: ['website' as const, 'mobile' as const] }, deletedAt: null }

    const [orders, lastWeekOrders, newCustomers, lowStock, openReturns] = await Promise.all([
      this.prisma.order.aggregate({
        where: { ...onlineFilter, createdAt: { gte: yesterday, lte: yesterdayEnd }, status: { in: ['confirmed', 'processing', 'shipped', 'delivered'] } },
        _sum: { totalAmount: true },
        _count: true,
      }),
      this.prisma.order.aggregate({
        where: { ...onlineFilter, createdAt: { gte: lastWeekSameDay, lte: lastWeekEnd }, status: { in: ['confirmed', 'processing', 'shipped', 'delivered'] } },
        _sum: { totalAmount: true },
        _count: true,
      }),
      this.prisma.user.count({
        where: { role: 'customer', createdAt: { gte: yesterday, lte: yesterdayEnd } },
      }),
      this.prisma.inventory.count({
        where: { quantityOnHand: { lte: 5 } },
      }),
      this.prisma.return.count({
        where: { status: { in: ['requested', 'label_sent', 'in_transit'] } },
      }),
    ])

    const revenue = Number(orders._sum?.totalAmount ?? 0)
    const orderCount = orders._count
    const lastWeekRevenue = Number(lastWeekOrders._sum?.totalAmount ?? 0)
    const lastWeekCount = lastWeekOrders._count

    const dateStr = yesterday.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

    await this.emailService.enqueue({
      to: recipientEmail,
      type: 'welcome' as any, // Reuse welcome template for now
      lang: 'de',
      data: {
        firstName: 'Admin',
        subject: `Tagesbericht — ${dateStr}`,
        content: [
          `Bestellungen: ${orderCount} (${revenue.toFixed(2)} EUR)`,
          `Letzte Woche gleicher Tag: ${lastWeekCount} (${lastWeekRevenue.toFixed(2)} EUR)`,
          `Neue Kunden: ${newCustomers}`,
          `Produkte unter Mindestbestand: ${lowStock}`,
          `Offene Retouren: ${openReturns}`,
        ].join('\n'),
      },
    })

    this.logger.log(`Daily summary sent to ${recipientEmail}: ${orderCount} orders, €${revenue.toFixed(2)}`)
  }
}
