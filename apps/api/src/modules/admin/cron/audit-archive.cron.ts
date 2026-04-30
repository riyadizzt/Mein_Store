/**
 * Audit-archive cron (C15.1).
 *
 * Runs daily at 03:00 Berlin-time (low-traffic window). Thin wrapper
 * around AuditArchiveService.runArchiveTick — actual logic + R2
 * upload + tier-guarded delete + audit-row write live in the service.
 *
 * Same SafeCron pattern as EbayOrderPullCron + EbayShippingPushCron +
 * ChannelSafetyStockCron. SafeCron emits a crash-event for truly
 * unexpected throws (network OOM, etc.) which CronCrashAlertService
 * surfaces as an admin-notification.
 *
 * Why a separate class:
 *   SafeCron registration requires NestJS DI; testing the algorithm
 *   without spinning up the scheduler is much easier with a thin
 *   DI-only wrapper and all logic in a service.
 */

import { Injectable } from '@nestjs/common'
import { SafeCron } from '../../../common/decorators/safe-cron.decorator'
import { AuditArchiveService } from '../services/audit-archive.service'

@Injectable()
export class AuditArchiveCron {
  constructor(private readonly archiveService: AuditArchiveService) {}

  @SafeCron('0 3 * * *', { name: 'audit-archive', timeZone: 'Europe/Berlin' })
  async tick(): Promise<void> {
    await this.archiveService.runArchiveTick()
  }
}
