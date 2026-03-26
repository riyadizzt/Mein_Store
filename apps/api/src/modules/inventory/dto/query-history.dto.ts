import { IsOptional, IsEnum, IsDateString, IsInt, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty } from '@nestjs/swagger'

const MOVEMENT_TYPES = [
  'purchase_received', 'sale_online', 'sale_pos', 'sale_social',
  'return_received', 'stocktake_adjustment', 'transfer', 'damaged',
  'expired', 'reserved', 'released', 'cancelled',
] as const

export type MovementType = (typeof MOVEMENT_TYPES)[number]

export class QueryHistoryDto {
  @ApiProperty({ required: false, enum: MOVEMENT_TYPES })
  @IsOptional()
  @IsEnum(MOVEMENT_TYPES)
  type?: MovementType

  @ApiProperty({ required: false, example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string

  @ApiProperty({ required: false, example: '2026-03-31' })
  @IsOptional()
  @IsDateString()
  dateTo?: string

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1

  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50
}
