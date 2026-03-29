import {
  IsArray, IsEnum, IsOptional, IsString, IsUUID,
  IsEmail, ValidateNested, ArrayMinSize, IsInt, Min,
} from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty } from '@nestjs/swagger'

export class OrderItemInputDto {
  @ApiProperty({ example: 'uuid-of-variant' })
  @IsUUID()
  variantId!: string

  @ApiProperty({ example: 'uuid-of-warehouse', required: false })
  @IsOptional()
  @IsUUID()
  warehouseId?: string

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number
}

export class CreateOrderDto {
  @ApiProperty({ type: [OrderItemInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items!: OrderItemInputDto[]

  @ApiProperty({ required: false, description: 'UUID einer gespeicherten Adresse' })
  @IsOptional()
  @IsUUID()
  shippingAddressId?: string

  @ApiProperty({
    required: false,
    description: 'ISO 3166-1 Ländercode für Versandberechnung (wenn keine Adresse)',
    example: 'DE',
  })
  @IsOptional()
  @IsString()
  countryCode?: string

  @ApiProperty({ required: false, enum: ['website', 'mobile', 'facebook', 'instagram', 'tiktok'] })
  @IsOptional()
  @IsEnum(['website', 'mobile', 'facebook', 'instagram', 'tiktok'])
  channel?: string

  @ApiProperty({ required: false, example: 'SOMMER20' })
  @IsOptional()
  @IsString()
  couponCode?: string

  @ApiProperty({ required: false, description: 'Für Gast-Checkout' })
  @IsOptional()
  @IsEmail()
  guestEmail?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  guestFirstName?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  guestLastName?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string

  @ApiProperty({ required: false, description: 'Locale for email language (de/en/ar)' })
  @IsOptional()
  @IsString()
  locale?: string
}
