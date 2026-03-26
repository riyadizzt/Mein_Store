import { IsString, IsOptional, IsUUID, IsInt, Min, ValidateNested, ArrayMinSize } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty } from '@nestjs/swagger'

export class CategoryTranslationDto {
  @ApiProperty({ enum: ['ar', 'en', 'de'] })
  @IsString()
  language!: 'ar' | 'en' | 'de'

  @ApiProperty({ example: 'Herren' })
  @IsString()
  name!: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string
}

export class CreateCategoryDto {
  @ApiProperty({ example: 'herren' })
  @IsString()
  slug!: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  parentId?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  imageUrl?: string

  @ApiProperty({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number

  @ApiProperty({ type: [CategoryTranslationDto] })
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => CategoryTranslationDto)
  translations!: CategoryTranslationDto[]
}
