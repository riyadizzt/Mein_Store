import { Module } from '@nestjs/common'
import { HealthController, PublicSettingsController, PublicShippingZonesController, GuestOrderController } from './health.controller'
import { PrismaModule } from '../../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [HealthController, PublicSettingsController, PublicShippingZonesController, GuestOrderController],
})
export class HealthModule {}
