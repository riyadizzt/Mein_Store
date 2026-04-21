import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { EmailModule } from '../email/email.module'
import { BackupController } from './backup.controller'
import { BackupService } from './backup.service'
import { BackupR2Client } from './backup-r2.client'
import { DailyBackupCron } from './daily-backup.cron'

@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [BackupController],
  providers: [BackupService, BackupR2Client, DailyBackupCron],
  exports: [BackupService],
})
export class BackupModule {}
