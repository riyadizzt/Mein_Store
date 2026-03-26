import { Module } from '@nestjs/common'
import { ShippingZonesController } from './shipping-zones/shipping-zones.controller'
import { ShippingZonesService } from './shipping-zones/shipping-zones.service'

@Module({
  controllers: [ShippingZonesController],
  providers: [ShippingZonesService],
})
export class AdminModule {}
