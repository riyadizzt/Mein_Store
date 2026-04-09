import { Injectable, Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { PrismaService } from '../../../prisma/prisma.service'

interface CreateNotificationData {
  userId?: string
  type: string
  title: string
  body: string
  entityType?: string
  entityId?: string
  channel?: string
  data?: any
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(data: CreateNotificationData) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: data.userId ?? null,
        type: data.type,
        title: data.title,
        body: data.body,
        entityType: data.entityType ?? null,
        entityId: data.entityId ?? null,
        channel: data.channel ?? 'admin',
        data: data.data ?? undefined,
      },
    })

    this.logger.log(
      `Notification created: type=${notification.type} channel=${notification.channel} id=${notification.id}`,
    )

    this.eventEmitter.emit('notification.created', notification)

    return notification
  }

  async createForAllAdmins(data: Omit<CreateNotificationData, 'userId'>) {
    const notification = await this.create({
      ...data,
      userId: undefined,
      channel: data.channel ?? 'admin',
    })

    // Send email notification to admin
    this.sendAdminEmail(data.type, data.title, data.body).catch((err) =>
      this.logger.error(`Admin email failed: ${err.message}`),
    )

    return notification
  }

  private async sendAdminEmail(type: string, title: string, body: string) {
    // Check if email notifications are enabled
    const emailEnabled = await this.prisma.shopSetting.findUnique({
      where: { key: 'notif_email_new_order' },
    })
    if (emailEnabled?.value === 'false') return

    // Get admin notification email
    const emailSetting = await this.prisma.shopSetting.findUnique({
      where: { key: 'notif_daily_summary_email' },
    })
    const adminEmail = emailSetting?.value?.trim()
    if (!adminEmail) {
      this.logger.warn('No admin email configured for notifications')
      return
    }

    // Send directly via Resend (bypass template system)
    try {
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.EMAIL_FROM_NOREPLY || 'noreply@malak-bekleidung.com'

      // Arabic translations for email
      const arTitles: Record<string, string> = {
        new_order: 'طلب جديد',
        order_confirmed: 'تأكيد الطلب',
        order_cancelled: 'إلغاء الطلب',
        order_delivered: 'تم التسليم',
        return_submitted: 'طلب إرجاع جديد',
        return_approved: 'تمت الموافقة على الإرجاع',
        return_rejected: 'تم رفض الإرجاع',
        return_received: 'تم استلام الإرجاع',
        return_refunded: 'تم الاسترداد',
        payment_failed: 'فشل الدفع',
      }
      const arTitle = arTitles[type] ? `${arTitles[type]} — ${title.replace(/^[^#]*#/, '#')}` : title
      // Arabic body: replace German words
      const arBody = body
        .replace(/von /g, 'من ')
        .replace(/Bestellung /g, 'طلب ')
        .replace(/ automatisch storniert/g, ' تم إلغاؤه تلقائياً')

      await resend.emails.send({
        from,
        to: adminEmail,
        subject: `ملاك — ${arTitle}`,
        html: `<div style="font-family:'Cairo',Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;direction:rtl;text-align:right">
          <div style="background:#1a1a2e;padding:20px;border-radius:12px;text-align:center;margin-bottom:20px">
            <h1 style="color:#d4a853;font-size:20px;letter-spacing:4px;margin:0">MALAK</h1>
            <p style="color:rgba(255,255,255,0.4);font-size:11px;margin:6px 0 0">إشعار إداري</p>
          </div>
          <h2 style="color:#0f1419;font-size:18px;margin:0 0 10px">${arTitle}</h2>
          <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 20px">${arBody}</p>
          <div style="text-align:center;margin:24px 0">
            <a href="${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/ar/admin" style="display:inline-block;background:#d4a853;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:bold">فتح لوحة التحكم</a>
          </div>
          <p style="color:#999;font-size:11px;margin-top:24px;text-align:center">ملاك للملابس — إشعارات إدارية</p>
        </div>`,
      })

      this.logger.log(`Admin email sent to ${adminEmail}: ${title}`)
    } catch (err: any) {
      this.logger.error(`Resend email failed: ${err.message}`)
    }
  }

  async findForAdmin(query: {
    limit?: number
    offset?: number
    isRead?: boolean
    type?: string
  }) {
    const limit = query.limit ?? 50
    const offset = query.offset ?? 0

    const where: any = { channel: 'admin' }
    if (query.isRead !== undefined) where.isRead = query.isRead
    if (query.type) where.type = query.type

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ])

    return { data: items, meta: { total, limit, offset } }
  }

  async findForUser(
    userId: string,
    query: { limit?: number; offset?: number; isRead?: boolean },
  ) {
    const limit = query.limit ?? 50
    const offset = query.offset ?? 0

    const where: any = { channel: 'customer', userId }
    if (query.isRead !== undefined) where.isRead = query.isRead

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ])

    return { data: items, meta: { total, limit, offset } }
  }

  async markAsRead(id: string) {
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    })
  }

  async markAllAsRead(channel: string, userId?: string) {
    const where: any = { channel, isRead: false }
    if (userId) where.userId = userId

    const result = await this.prisma.notification.updateMany({
      where,
      data: { isRead: true },
    })

    this.logger.log(
      `Marked ${result.count} notifications as read: channel=${channel} userId=${userId ?? 'all'}`,
    )

    return { count: result.count }
  }

  async getUnreadCount(channel: string, userId?: string) {
    const where: any = { channel, isRead: false }
    if (userId) where.userId = userId

    const count = await this.prisma.notification.count({ where })
    return { count }
  }

  async cleanup(days: number = 90) {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)

    const result = await this.prisma.notification.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
        isRead: true,
      },
    })

    this.logger.log(
      `Cleaned up ${result.count} notifications older than ${days} days`,
    )

    return { deleted: result.count }
  }
}
