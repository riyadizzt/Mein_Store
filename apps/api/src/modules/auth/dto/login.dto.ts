import { IsEmail, IsString } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class LoginDto {
  @ApiProperty({ example: 'kunde@beispiel.de' })
  @IsEmail()
  email!: string

  @ApiProperty({ example: 'MaxMustermann1!' })
  @IsString()
  password!: string
}

export class RefreshTokenDto {
  @IsString()
  refreshToken!: string
}
