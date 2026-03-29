import { Module } from '@nestjs/common'
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

@Module({
  imports: [PrismaModule, PaymentsModule, ShipmentsModule, EmailModule],
  controllers: [AdminController, ShippingZonesController],
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
  ],
  exports: [AuditService],
})
export class AdminModule {}
