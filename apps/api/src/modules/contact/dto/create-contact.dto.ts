import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class CreateContactDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string

  @IsEmail()
  @MaxLength(120)
  email!: string

  @IsString()
  @MinLength(2)
  @MaxLength(150)
  subject!: string

  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  message!: string

  @IsOptional()
  @IsIn(['de', 'en', 'ar'])
  locale?: string

  // Honeypot — legitimate users never see or fill this; bots always do.
  // Service rejects any request where the field is non-empty.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string
}
