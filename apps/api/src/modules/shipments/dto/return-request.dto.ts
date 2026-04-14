import { IsArray, IsEnum, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { ReturnReason } from '@prisma/client'

export class ReturnItemDto {
  @IsString()
  variantId!: string

  @IsOptional()
  @IsNumber()
  quantity?: number

  @IsEnum(ReturnReason)
  reason!: ReturnReason

  @IsOptional()
  @IsString()
  notes?: string
}

export class CreateReturnRequestDto {
  @IsEnum(ReturnReason)
  reason!: ReturnReason

  @IsOptional()
  @IsString()
  notes?: string

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items?: ReturnItemDto[]
}
