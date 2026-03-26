import { IsEmail, IsString, MinLength, Matches, IsOptional, IsIn } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'
import { Language } from '@omnichannel/types'

export class RegisterDto {
  @ApiProperty({ example: 'kunde@beispiel.de' })
  @IsEmail({}, { message: 'Ungültige E-Mail-Adresse' })
  email!: string

  @ApiProperty({ example: 'MaxMustermann1!' })
  @IsString()
  @MinLength(8, { message: 'Passwort muss mindestens 8 Zeichen haben' })
  @Matches(/^(?=.*[0-9])(?=.*[!@#$%^&*])/, {
    message: 'Passwort muss mindestens eine Zahl und ein Sonderzeichen enthalten',
  })
  password!: string

  @ApiProperty({ example: 'Max' })
  @IsString()
  @MinLength(2)
  firstName!: string

  @ApiProperty({ example: 'Mustermann' })
  @IsString()
  @MinLength(2)
  lastName!: string

  @ApiProperty({ example: '+49 170 1234567', required: false })
  @IsOptional()
  @IsString()
  phone?: string

  @ApiProperty({ enum: ['ar', 'en', 'de'], default: 'de' })
  @IsOptional()
  @IsIn(['ar', 'en', 'de'])
  preferredLang?: Language

  @ApiProperty({ description: 'GDPR Einwilligung — Pflichtfeld' })
  gdprConsent!: boolean
}
