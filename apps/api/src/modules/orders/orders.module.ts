import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { OrdersController } from './orders.controller'
import { CouponsController } from './coupons.controller'
import { OrdersService } from './orders.service'
import { IdempotencyService } from './idempotency.service'
import { InventoryListener } from './listeners/inventory.listener'
import { ZoneBasedCalculator } from './shipping/zone-based.calculator'
import { SHIPPING_CALCULATOR } from './shipping/shipping-calculator.interface'
import { InventoryModule } from '../inventory/inventory.module'
import { AdminModule } from '../admin/admin.module'

@Module({
  imports: [ConfigModule, InventoryModule, AdminModule],
  controllers: [OrdersController, CouponsController],
  providers: [
    OrdersService,
    IdempotencyService,
    InventoryListener,
    // Shipping Calculator — via SHIPPING_PROVIDER in .env umschaltbar
    {
      provide: SHIPPING_CALCULATOR,
      useFactory: (_config: ConfigService, zoneCalc: ZoneBasedCalculator) => {
        // Später: if (provider === 'dhl') return new DHLApiCalculator(...)
        return zoneCalc
      },
      inject: [ConfigService, ZoneBasedCalculator],
    },
    ZoneBasedCalculator,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
