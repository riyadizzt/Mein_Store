import {
  IsString, IsOptional, IsUUID, IsNumber, IsBoolean,
  IsEnum, ValidateNested, ArrayMinSize, IsArray, Min, Max,
} from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty } from '@nestjs/swagger'

export class ProductTranslationDto {
  @ApiProperty({ enum: ['ar', 'en', 'de'] })
  @IsEnum(['ar', 'en', 'de'])
  language!: 'ar' | 'en' | 'de'

  @ApiProperty({ example: 'Klassische Lederjacke' })
  @IsString()
  name!: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  sizeGuide?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  metaTitle?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  metaDesc?: string
}

export class ProductVariantDto {
  @ApiProperty({ example: 'JACK-BLK-L' })
  @IsString()
  sku!: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  barcode?: string

  @ApiProperty({ required: false, example: 'Schwarz' })
  @IsOptional()
  @IsString()
  color?: string

  @ApiProperty({ required: false, example: '#000000' })
  @IsOptional()
  @IsString()
  colorHex?: string

  @ApiProperty({ required: false, example: 'L' })
  @IsOptional()
  @IsString()
  size?: string

  @ApiProperty({ required: false, enum: ['EU', 'US', 'UK'] })
  @IsOptional()
  @IsEnum(['EU', 'US', 'UK'])
  sizeSystem?: 'EU' | 'US' | 'UK'

  @ApiProperty({ default: 0 })
  @IsOptional()
  @IsNumber()
  priceModifier?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  weightGrams?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  initialStock?: number
}

export class CreateProductDto {
  @ApiProperty({ example: 'klassische-lederjacke' })
  @IsString()
  slug!: string

  @ApiProperty()
  @IsUUID()
  categoryId!: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  brand?: string

  @ApiProperty({ required: false, enum: ['men', 'women', 'kids', 'unisex'] })
  @IsOptional()
  @IsEnum(['men', 'women', 'kids', 'unisex'])
  gender?: string

  @ApiProperty({ example: 129.99 })
  @IsNumber()
  @Min(0)
  basePrice!: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  salePrice?: number

  @ApiProperty({ default: 19 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate?: number

  @ApiProperty({ default: false })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean

  @ApiProperty({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean

  @ApiProperty({ type: [ProductTranslationDto] })
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => ProductTranslationDto)
  translations!: ProductTranslationDto[]

  @ApiProperty({ type: [ProductVariantDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => ProductVariantDto)
  variants!: ProductVariantDto[]
}
