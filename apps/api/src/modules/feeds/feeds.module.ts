import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { EmailModule } from '../email/email.module'
import { AdminModule } from '../admin/admin.module'
import { FeedsService } from './feeds.service'
import { FeedsController } from './feeds.controller'

@Module({
  // EmailModule is imported so FeedsService can @Optional()-inject
  // EmailService for hard-fail admin alerts. AdminModule gives us the
  // AuditService for controller-side audit entries on token regen +
  // cache clear (admin-triggered actions only, per Q1).
  imports: [PrismaModule, EmailModule, AdminModule],
  controllers: [FeedsController],
  providers: [FeedsService],
  exports: [FeedsService],
})
export class FeedsModule {}
