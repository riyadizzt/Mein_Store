import { IsEnum, IsUUID } from 'class-validator'
import { ShipmentCarrier } from '@prisma/client'

export class CreateShipmentDto {
  @IsUUID()
  orderId!: string

  @IsEnum(ShipmentCarrier)
  carrier!: ShipmentCarrier
}
