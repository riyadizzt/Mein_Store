import { Injectable, Logger } from '@nestjs/common'
import { SafeCron } from '../../../common/decorators/safe-cron.decorator'
import { PrismaService } from '../../../prisma/prisma.service'
import { EmailService } from '../../email/email.service'

@Injectable()
export class DailySummaryCron {
  private readonly logger = new Logger(DailySummaryCron.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  @SafeCron('0 8 * * *') // Every day at 08:00
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
    const dateStrAr = yesterday.toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

    // Determine language from admin preferences
    const adminUser = await this.prisma.user.findFirst({ where: { email: recipientEmail } })
    const lang = adminUser?.preferredLang ?? 'ar'

    const appUrl = process.env.APP_URL || 'http://localhost:3000'

    await this.emailService.enqueue({
      to: recipientEmail,
      type: 'daily-summary' as any,
      lang,
      data: {
        firstName: adminUser?.firstName ?? 'Admin',
        subject: lang === 'ar' ? `التقرير اليومي — ${dateStrAr}` : `Tagesbericht — ${dateStr}`,
        dateStr: lang === 'ar' ? dateStrAr : dateStr,
        orderCount,
        revenue: revenue.toFixed(2),
        lastWeekCount,
        lastWeekRevenue: lastWeekRevenue.toFixed(2),
        newCustomers,
        lowStock,
        lowStockAlert: lowStock > 50,
        openReturns,
        dashboardUrl: `${appUrl}/${lang}/admin/dashboard`,
      },
    })

    this.logger.log(`Daily summary sent to ${recipientEmail}: ${orderCount} orders, €${revenue.toFixed(2)}`)
  }
}
