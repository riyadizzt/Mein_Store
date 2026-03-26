import { IsString, IsUUID, IsInt, IsNotEmpty, Min } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class TransferInventoryDto {
  @ApiProperty({ example: 'uuid-of-variant' })
  @IsUUID()
  variantId!: string

  @ApiProperty({ example: 'uuid-of-source-warehouse' })
  @IsUUID()
  fromWarehouseId!: string

  @ApiProperty({ example: 'uuid-of-target-warehouse' })
  @IsUUID()
  toWarehouseId!: string

  @ApiProperty({ description: 'Anzahl zu transferierender Einheiten', example: 10 })
  @IsInt()
  @Min(1)
  quantity!: number

  @ApiProperty({
    description: 'Pflichtbegründung für den Transfer',
    example: 'Saisonaler Ausgleich — Lager München → Filiale Berlin',
  })
  @IsString()
  @IsNotEmpty()
  reason!: string
}
