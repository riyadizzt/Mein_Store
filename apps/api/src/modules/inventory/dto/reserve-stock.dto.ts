import { IsUUID, IsInt, IsOptional, IsString, Min } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class ReserveStockDto {
  @ApiProperty({ example: 'uuid-of-variant' })
  @IsUUID()
  variantId!: string

  @ApiProperty({ example: 'uuid-of-warehouse' })
  @IsUUID()
  warehouseId!: string

  @ApiProperty({ description: 'Anzahl zu reservierender Einheiten', example: 1 })
  @IsInt()
  @Min(1)
  quantity!: number

  @ApiProperty({ required: false, description: 'Order-ID falls bereits vorhanden' })
  @IsOptional()
  @IsUUID()
  orderId?: string

  @ApiProperty({ required: false, description: 'Session-ID für Gast-Checkout' })
  @IsOptional()
  @IsString()
  sessionId?: string
}
