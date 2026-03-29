import { IsString, IsOptional, IsEnum, MaxLength, IsMobilePhone } from 'class-validator'
import { Language } from '@prisma/client'

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  firstName?: string

  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastName?: string

  @IsOptional()
  @IsMobilePhone()
  phone?: string

  @IsOptional()
  @IsEnum(Language)
  preferredLang?: Language
}
