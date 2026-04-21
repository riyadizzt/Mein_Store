/**
 * Daily DB backup cron — 03:00 UTC every day.
 *
 * Uses @SafeCron so a crash emits the `cron.crashed` event + falls
 * into CronCrashAlertService → admin notification. BackupService
 * itself also emits a dedicated failure email (German, because
 * backup ops are not customer-facing).
 */
import { Injectable, Logger } from '@nestjs/common'
import { SafeCron } from '../../common/decorators/safe-cron.decorator'
import { BackupService } from './backup.service'

@Injectable()
export class DailyBackupCron {
  private readonly logger = new Logger(DailyBackupCron.name)

  constructor(private readonly backup: BackupService) {}

  @SafeCron('0 3 * * *', { name: 'daily-backup', timeZone: 'UTC' })
  async runDailyBackup(): Promise<void> {
    this.logger.log('Daily backup cron firing (03:00 UTC)')
    // Swallow the throw — BackupService.runBackup has already logged,
    // persisted the FAILED row, emitted Sentry, and queued the admin
    // email. Re-throwing here would trigger the SafeCron crash event
    // which would DUPLICATE the alert (second admin-notification).
    try {
      await this.backup.runBackup({ type: 'DAILY', triggeredByUserId: null })
    } catch (_err) {
      // already handled in BackupService — intentionally silent here.
    }
  }
}
