import { IsString, IsUUID, IsInt, IsNotEmpty, Min, Max } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class AdjustInventoryDto {
  @ApiProperty({ example: 'uuid-of-variant' })
  @IsUUID()
  variantId!: string

  @ApiProperty({ example: 'uuid-of-warehouse' })
  @IsUUID()
  warehouseId!: string

  @ApiProperty({
    description: 'Korrekturbetrag (positiv = Zugang, negativ = Abgang)',
    example: -5,
  })
  @IsInt()
  @Min(-10000)
  @Max(10000)
  adjustment!: number

  @ApiProperty({
    description: 'Pflichtbegründung für jede manuelle Korrektur',
    example: 'Inventur 2026-03 — Differenz nach Zählung festgestellt',
  })
  @IsString()
  @IsNotEmpty()
  reason!: string
}
