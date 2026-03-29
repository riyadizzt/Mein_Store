import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'

export interface AuditLogEntry {
  adminId: string
  action: string
  entityType: string
  entityId?: string
  changes?: { before?: Record<string, unknown>; after?: Record<string, unknown> }
  ipAddress?: string
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditLogEntry): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: {
        adminId: entry.adminId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        changes: entry.changes as any,
        ipAddress: entry.ipAddress,
      },
    })

    this.logger.log(
      `AUDIT: ${entry.action} | ${entry.entityType}:${entry.entityId ?? '-'} | by=${entry.adminId}`,
    )
  }

  async findAll(query: {
    adminId?: string
    action?: string
    page?: number
    limit?: number
  }) {
    const page = query.page ?? 1
    const limit = query.limit ?? 50
    const where: any = {}
    if (query.adminId) where.adminId = query.adminId
    if (query.action) where.action = { contains: query.action, mode: 'insensitive' }

    const [items, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.adminAuditLog.count({ where }),
    ])

    // Resolve admin names
    const adminIds = [...new Set(items.map((i) => i.adminId))]
    const admins = await this.prisma.user.findMany({
      where: { id: { in: adminIds } },
      select: { id: true, firstName: true, lastName: true, email: true },
    })
    const adminMap = new Map(admins.map((a) => [a.id, a]))

    return {
      data: items.map((log) => {
        const admin = adminMap.get(log.adminId)
        return {
          ...log,
          adminName: admin ? `${admin.firstName} ${admin.lastName}` : log.adminId.slice(0, 8),
          adminEmail: admin?.email,
        }
      }),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    }
  }

  async getAdmins() {
    return this.prisma.user.findMany({
      where: { role: { in: ['admin', 'super_admin'] }, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: 'asc' },
    })
  }

  async getActionTypes() {
    const actions = await this.prisma.adminAuditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    })
    return actions.map((a) => a.action)
  }

  async getRecentActions(limit = 10) {
    return this.prisma.adminAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  async getByEntity(entityType: string, entityId: string) {
    return this.prisma.adminAuditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
    })
  }
}
