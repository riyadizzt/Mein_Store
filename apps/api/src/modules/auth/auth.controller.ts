import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Ip,
  UseGuards,
  Get,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { AuthService } from './auth.service'
import { RegisterDto } from './dto/register.dto'
import { LoginDto, RefreshTokenDto } from './dto/login.dto'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Neues Kundenkonto erstellen' })
  async register(@Body() dto: RegisterDto) {
    const tokens = await this.authService.register(dto)
    return { success: true, data: tokens }
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 5, ttl: 60000 } }) // max 5 Login-Versuche pro Minute
  @ApiOperation({ summary: 'Einloggen' })
  async login(@Body() dto: LoginDto, @Ip() ip: string) {
    const tokens = await this.authService.login(dto, ip)
    return { success: true, data: tokens }
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Access Token erneuern' })
  async refresh(@Body() dto: RefreshTokenDto) {
    const tokens = await this.authService.refreshTokens(dto.refreshToken)
    return { success: true, data: tokens }
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 3, ttl: 300000 } }) // max 3 Versuche pro 5 Min.
  @ApiOperation({ summary: 'Passwort-Reset anfordern' })
  async forgotPassword(@Body('email') email: string) {
    await this.authService.requestPasswordReset(email)
    // Immer gleiche Antwort — Sicherheit
    return {
      success: true,
      message: 'Falls die E-Mail registriert ist, erhalten Sie eine Nachricht.',
    }
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Passwort zurücksetzen' })
  async resetPassword(@Body('token') token: string, @Body('password') password: string) {
    await this.authService.resetPassword(token, password)
    return { success: true, message: 'Passwort erfolgreich geändert. Bitte erneut einloggen.' }
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Aktuellen Benutzer abrufen' })
  async me(@CurrentUser() user: any) {
    return { success: true, data: user }
  }
}
