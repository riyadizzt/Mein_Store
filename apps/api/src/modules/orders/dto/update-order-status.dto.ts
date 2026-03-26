import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

const ORDER_STATUSES = [
  'pending', 'pending_payment', 'confirmed', 'processing',
  'shipped', 'delivered', 'cancelled', 'returned', 'refunded',
] as const

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: ORDER_STATUSES })
  @IsEnum(ORDER_STATUSES)
  status!: (typeof ORDER_STATUSES)[number]

  @ApiProperty({ required: false, description: 'Referenz (paymentId, shipmentId, ...)' })
  @IsOptional()
  @IsUUID()
  referenceId?: string

  @ApiProperty({ required: false, example: 'Zahlung eingegangen' })
  @IsOptional()
  @IsString()
  notes?: string
}
