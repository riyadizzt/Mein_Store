import { IsOptional, IsEnum, IsString, IsInt, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty } from '@nestjs/swagger'

const ORDER_STATUSES = [
  'pending', 'pending_payment', 'confirmed', 'processing',
  'shipped', 'delivered', 'cancelled', 'returned', 'refunded',
] as const

export class QueryOrdersDto {
  @ApiProperty({
    required: false,
    description: 'Cursor für nächste Seite (aus meta.nextCursor der vorherigen Antwort)',
  })
  @IsOptional()
  @IsString()
  cursor?: string

  @ApiProperty({ required: false, default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20

  @ApiProperty({ required: false, enum: ORDER_STATUSES })
  @IsOptional()
  @IsEnum(ORDER_STATUSES)
  status?: (typeof ORDER_STATUSES)[number]

  @ApiProperty({ required: false, enum: ['website', 'mobile', 'pos', 'facebook', 'instagram', 'tiktok', 'google', 'whatsapp'] })
  @IsOptional()
  @IsEnum(['website', 'mobile', 'pos', 'facebook', 'instagram', 'tiktok', 'google', 'whatsapp'])
  channel?: string

  @ApiProperty({ required: false, example: '2026-01-01' })
  @IsOptional()
  @IsString()
  dateFrom?: string

  @ApiProperty({ required: false, example: '2026-03-31' })
  @IsOptional()
  @IsString()
  dateTo?: string
}
