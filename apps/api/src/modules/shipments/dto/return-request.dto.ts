import { IsEnum, IsOptional, IsString } from 'class-validator'
import { ReturnReason } from '@prisma/client'

export class CreateReturnRequestDto {
  @IsEnum(ReturnReason)
  reason!: ReturnReason

  @IsOptional()
  @IsString()
  notes?: string
}
