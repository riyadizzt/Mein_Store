import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'

@Injectable()
export class CampaignService {
  private readonly logger = new Logger(CampaignService.name)

  constructor(private readonly prisma: PrismaService) {}

  /** List all campaigns with optional status filter */
  async findAll(status?: string) {
    const where: any = {}
    if (status) where.status = status
    const campaigns = await this.prisma.campaign.findMany({
      where,
      orderBy: { startAt: 'desc' },
    })
    // Auto-update status based on dates
    const now = new Date()
    for (const c of campaigns) {
      const newStatus = this.computeStatus(c, now)
      if (newStatus !== c.status) {
        await this.prisma.campaign.update({ where: { id: c.id }, data: { status: newStatus } })
        c.status = newStatus
      }
    }
    return campaigns
  }

  /** Get single campaign */
  async findOne(id: string) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } })
    if (!campaign) throw new NotFoundException('Campaign not found')
    return campaign
  }

  /** Get currently active campaign (for shop frontend) */
  async getActiveCampaign() {
    const now = new Date()
    const campaign = await this.prisma.campaign.findFirst({
      where: {
        status: 'active',
        startAt: { lte: now },
        endAt: { gte: now },
      },
      orderBy: { startAt: 'desc' },
    })
    return campaign ?? null
  }

  /** Create campaign */
  async create(data: any, userId?: string) {
    if (new Date(data.endAt) <= new Date(data.startAt)) {
      throw new BadRequestException('End date must be after start date')
    }
    const slug = data.slug || this.generateSlug(data.name)
    const status = this.computeStatus({ startAt: new Date(data.startAt), endAt: new Date(data.endAt) } as any, new Date())

    const campaign = await this.prisma.campaign.create({
      data: {
        ...data,
        slug,
        status: data.status === 'draft' ? 'draft' : status,
        startAt: new Date(data.startAt),
        endAt: new Date(data.endAt),
        createdBy: userId,
      },
    })
    this.logger.log(`Campaign created: ${campaign.name} (${campaign.id})`)
    return campaign
  }

  /** Update campaign */
  async update(id: string, data: any) {
    const existing = await this.prisma.campaign.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException('Campaign not found')

    if (data.startAt && data.endAt && new Date(data.endAt) <= new Date(data.startAt)) {
      throw new BadRequestException('End date must be after start date')
    }

    const updated: any = { ...data }
    if (data.startAt) updated.startAt = new Date(data.startAt)
    if (data.endAt) updated.endAt = new Date(data.endAt)

    // Recalculate status if dates changed
    if (data.startAt || data.endAt) {
      const start = new Date(data.startAt ?? existing.startAt)
      const end = new Date(data.endAt ?? existing.endAt)
      if (updated.status !== 'draft') {
        updated.status = this.computeStatus({ startAt: start, endAt: end } as any, new Date())
      }
    }

    const campaign = await this.prisma.campaign.update({ where: { id }, data: updated })
    this.logger.log(`Campaign updated: ${campaign.name}`)
    return campaign
  }

  /** Delete campaign */
  async remove(id: string) {
    await this.prisma.campaign.delete({ where: { id } })
    this.logger.log(`Campaign deleted: ${id}`)
  }

  /** Duplicate campaign */
  async duplicate(id: string) {
    const original = await this.prisma.campaign.findUnique({ where: { id } })
    if (!original) throw new NotFoundException('Campaign not found')

    const { id: _id, slug: _slug, createdAt: _c, updatedAt: _u, ...rest } = original
    const campaign = await this.prisma.campaign.create({
      data: {
        ...rest,
        name: `${original.name} (Kopie)`,
        slug: `${original.slug}-copy-${Date.now()}`,
        status: 'draft',
      },
    })
    return campaign
  }

  /** Auto-compute status based on dates */
  private computeStatus(campaign: { startAt: Date; endAt: Date }, now: Date): string {
    if (now < campaign.startAt) return 'scheduled'
    if (now >= campaign.startAt && now <= campaign.endAt) return 'active'
    return 'ended'
  }

  /** Get campaign performance stats */
  async getStats(id: string) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } })
    if (!campaign) throw new NotFoundException('Campaign not found')

    // Count orders during campaign period
    const [orderCount, orderTotal] = await Promise.all([
      this.prisma.order.count({
        where: {
          createdAt: { gte: campaign.startAt, lte: campaign.endAt },
          status: { notIn: ['cancelled'] },
          deletedAt: null,
        },
      }),
      this.prisma.order.aggregate({
        where: {
          createdAt: { gte: campaign.startAt, lte: campaign.endAt },
          status: { notIn: ['cancelled'] },
          deletedAt: null,
        },
        _sum: { totalAmount: true },
      }),
    ])

    // Compare with same duration before campaign
    const duration = campaign.endAt.getTime() - campaign.startAt.getTime()
    const beforeStart = new Date(campaign.startAt.getTime() - duration)
    const beforeOrders = await this.prisma.order.count({
      where: {
        createdAt: { gte: beforeStart, lte: campaign.startAt },
        status: { notIn: ['cancelled'] },
        deletedAt: null,
      },
    })

    return {
      campaignId: id,
      period: { start: campaign.startAt, end: campaign.endAt },
      orders: orderCount,
      revenue: Number(orderTotal._sum?.totalAmount ?? 0),
      ordersBeforeCampaign: beforeOrders,
      uplift: beforeOrders > 0 ? Math.round(((orderCount - beforeOrders) / beforeOrders) * 100) : null,
    }
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[äÄ]/g, 'ae').replace(/[öÖ]/g, 'oe').replace(/[üÜ]/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
      .replace(/^-|-$/g, '') || `campaign-${Date.now()}`
  }
}
