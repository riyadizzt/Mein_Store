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
    return this.create({
      ...data,
      userId: undefined,
      channel: data.channel ?? 'admin',
    })
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
