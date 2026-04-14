import { Module } from '@nestjs/common'
import { PermissionGuard } from '../../common/permissions/permission.guard'
import { PrismaModule } from '../../prisma/prisma.module'
import { PaymentsModule } from '../payments/payments.module'
import { EmailModule } from '../email/email.module'
import { ShipmentsModule } from '../shipments/shipments.module'
import { AdminController } from './admin.controller'
import { ShippingZonesController } from './shipping-zones/shipping-zones.controller'
import { ShippingZonesService } from './shipping-zones/shipping-zones.service'
import { AuditService } from './services/audit.service'
import { DashboardService } from './services/dashboard.service'
import { AdminOrdersService } from './services/admin-orders.service'
import { AdminUsersService } from './services/admin-users.service'
import { AdminProductsService } from './services/admin-products.service'
import { AdminInventoryService } from './services/admin-inventory.service'
import { AdminReturnsService } from './services/admin-returns.service'
import { AdminStaffService } from './services/admin-staff.service'
import { FinanceReportsService } from './services/finance-reports.service'
import { AdminMarketingService } from './services/admin-marketing.service'
import { NotificationService } from './services/notification.service'
import { NotificationListener } from './listeners/notification.listener'
import { NotificationSseController } from './sse/notification-sse.controller'
import { DailySummaryCron } from './cron/daily-summary.cron'
import { PaymentTimeoutCron } from './cron/payment-timeout.cron'
import { ExpiryReminderCron } from './cron/expiry-reminder.cron'
import { AdminSuppliersService } from './services/admin-suppliers.service'
import { TranslationService } from '../../common/services/translation.service'
import { CampaignService } from './services/campaign.service'

@Module({
  imports: [PrismaModule, PaymentsModule, ShipmentsModule, EmailModule],
  controllers: [AdminController, ShippingZonesController, NotificationSseController],
  providers: [
    AuditService,
    DashboardService,
    AdminOrdersService,
    AdminUsersService,
    AdminProductsService,
    AdminInventoryService,
    AdminReturnsService,
    AdminStaffService,
    ShippingZonesService,
    FinanceReportsService,
    AdminMarketingService,
    NotificationService,
    NotificationListener,
    DailySummaryCron,
    ExpiryReminderCron,
    PaymentTimeoutCron,
    AdminSuppliersService,
    TranslationService,
    CampaignService,
    PermissionGuard,
  ],
  exports: [AuditService, AdminMarketingService, NotificationService, AdminReturnsService, AdminInventoryService],
})
export class AdminModule {}
