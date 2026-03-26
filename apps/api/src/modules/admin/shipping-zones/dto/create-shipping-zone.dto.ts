import {
  IsString, IsNumber, IsArray, IsOptional,
  IsBoolean, Min, ArrayMinSize, IsNotEmpty,
} from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class CreateShippingZoneDto {
  @ApiProperty({ example: 'Deutschland' })
  @IsString()
  @IsNotEmpty()
  zoneName!: string

  @ApiProperty({ example: ['DE'], description: 'ISO 3166-1 Ländercodes' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  countryCodes!: string[]

  @ApiProperty({ example: 8.0, description: 'Grundpreis in EUR' })
  @IsNumber()
  @Min(0)
  basePrice!: number

  @ApiProperty({ required: false, example: 100.0, description: 'Ab diesem Bestellwert kostenloser Versand' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  freeShippingThreshold?: number

  @ApiProperty({ required: false, example: 2.5, description: 'Gewichtszuschlag pro kg in EUR' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  weightSurchargePerKg?: number

  @ApiProperty({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}
