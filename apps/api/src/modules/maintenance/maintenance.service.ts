import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name)
  private cache: Record<string, string> = {}
  private cacheTime = 0

  constructor(private readonly prisma: PrismaService) {}

  async isMaintenanceMode(): Promise<boolean> {
    const settings = await this.getSettings()
    return settings.maintenance_enabled === 'true'
  }

  async getSettings(): Promise<Record<string, string>> {
    if (Date.now() - this.cacheTime < 10_000) return this.cache
    const rows = await this.prisma.shopSetting.findMany({ where: { key: { startsWith: 'maintenance_' } } })
    const map: Record<string, string> = {}
    for (const r of rows) map[r.key] = r.value
    this.cache = map
    this.cacheTime = Date.now()
    return map
  }

  async getPublicSettings(): Promise<Record<string, string>> {
    const s = await this.getSettings()
    if (s.maintenance_enabled !== 'true') return { maintenance_enabled: 'false' }

    // Self-heal: if a countdown was set and is already past, flip the flag
    // off inline rather than waiting up to 60s for the Cron tick. The Cron
    // still runs and is the authoritative auto-disable path, but this makes
    // the maintenance-page redirect snap the moment the countdown expires.
    if (s.maintenance_countdown_enabled === 'true' && s.maintenance_countdown_end) {
      const end = new Date(s.maintenance_countdown_end)
      if (!isNaN(end.getTime()) && Date.now() >= end.getTime()) {
        await this.prisma.shopSetting.upsert({
          where: { key: 'maintenance_enabled' },
          create: { key: 'maintenance_enabled', value: 'false' },
          update: { value: 'false' },
        })
        this.cacheTime = 0
        this.logger.log('Maintenance mode self-healed on status read (countdown expired)')
        return { maintenance_enabled: 'false' }
      }
    }

    // Get social links from shop settings
    const social = await this.prisma.shopSetting.findMany({
      where: { key: { in: ['instagramUrl', 'facebookUrl', 'tiktokUrl', 'logoUrl'] } },
    })
    const socialMap: Record<string, string> = {}
    for (const r of social) socialMap[r.key] = r.value
    return { ...s, ...socialMap }
  }

  async collectEmail(email: string, locale: string): Promise<boolean> {
    try {
      await this.prisma.maintenanceEmail.upsert({
        where: { email },
        create: { email, locale },
        update: { locale },
      })
      return true
    } catch {
      return false
    }
  }

  async getCollectedEmails() {
    return this.prisma.maintenanceEmail.findMany({ orderBy: { createdAt: 'desc' } })
  }

  async getEmailCount(): Promise<number> {
    return this.prisma.maintenanceEmail.count()
  }

  // Track page views
  async trackView() {
    const key = 'maintenance_views'
    const current = await this.prisma.shopSetting.findFirst({ where: { key } })
    const count = Number(current?.value ?? 0) + 1
    await this.prisma.shopSetting.upsert({
      where: { key },
      create: { key, value: String(count) },
      update: { value: String(count) },
    })
  }

  // Auto-disable cron — checks every minute
  @Cron('* * * * *')
  async checkAutoDisable() {
    const settings = await this.getSettings()
    if (settings.maintenance_enabled !== 'true') return
    if (!settings.maintenance_countdown_end) return

    const end = new Date(settings.maintenance_countdown_end)
    if (isNaN(end.getTime())) return
    if (new Date() >= end) {
      await this.prisma.shopSetting.upsert({
        where: { key: 'maintenance_enabled' },
        create: { key: 'maintenance_enabled', value: 'false' },
        update: { value: 'false' },
      })
      this.cacheTime = 0 // invalidate cache
      this.logger.log('Maintenance mode auto-disabled (countdown expired)')

      // Notification — typed so the admin bell can render it in the
      // viewing locale (DE title/body are kept as the raw fallback).
      try {
        await this.prisma.notification.create({
          data: {
            type: 'maintenance_auto_ended',
            title: 'Wartungsmodus automatisch beendet',
            body: 'Der Shop ist wieder online — Countdown ist abgelaufen.',
            channel: 'admin',
            data: { reason: 'countdown_expired' },
          },
        })
      } catch {}

      // Audit
      try {
        await this.prisma.adminAuditLog.create({
          data: {
            adminId: 'system', action: 'MAINTENANCE_AUTO_DISABLED',
            entityType: 'settings', changes: { after: { auto: true } }, ipAddress: '::system',
          },
        })
      } catch {}
    }
  }
}
