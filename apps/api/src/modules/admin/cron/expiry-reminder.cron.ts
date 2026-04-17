import { Injectable, Logger } from '@nestjs/common'
import { SafeCron } from '../../../common/decorators/safe-cron.decorator'
import { PrismaService } from '../../../prisma/prisma.service'
import { NotificationService } from '../services/notification.service'

@Injectable()
export class ExpiryReminderCron {
  private readonly logger = new Logger(ExpiryReminderCron.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  @SafeCron('0 9 * * *') // Every day at 09:00
  async checkExpiringItems() {
    const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const now = new Date()

    // 1. Expiring coupons (within 24h)
    const expiringCoupons = await this.prisma.coupon.findMany({
      where: { isActive: true, expiresAt: { gte: now, lte: in24h } },
      select: { id: true, code: true, expiresAt: true },
    })

    for (const coupon of expiringCoupons) {
      await this.notificationService.createForAllAdmins({
        type: 'coupon_expiring',
        title: `Gutschein ${coupon.code} läuft bald ab`,
        body: `Ablauf: ${coupon.expiresAt?.toLocaleDateString('de-DE')} — jetzt verlängern oder deaktivieren`,
        entityType: 'coupon',
        entityId: coupon.id,
        data: { code: coupon.code, expiresAt: coupon.expiresAt },
      })
    }

    // 2. Expiring promotions (within 24h)
    const expiringPromotions = await this.prisma.promotion.findMany({
      where: { isActive: true, endAt: { gte: now, lte: in24h } },
      select: { id: true, name: true, endAt: true },
    })

    for (const promo of expiringPromotions) {
      await this.notificationService.createForAllAdmins({
        type: 'promotion_expiring',
        title: `Aktion "${promo.name}" endet bald`,
        body: `Ende: ${promo.endAt.toLocaleDateString('de-DE')} — verlängern oder neue Aktion erstellen`,
        entityType: 'promotion',
        entityId: promo.id,
        data: { name: promo.name, endAt: promo.endAt },
      })
    }

    const total = expiringCoupons.length + expiringPromotions.length
    if (total > 0) this.logger.log(`Expiry reminders sent: ${expiringCoupons.length} coupons, ${expiringPromotions.length} promotions`)
  }
}
