import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Ip,
  UseGuards,
  Get,
  Query,
  Headers,
  Req,
  Res,
  NotFoundException,
} from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { Request, Response } from 'express'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { AuthService } from './auth.service'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

const REFRESH_COOKIE = 'malak_refresh'
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000 // 30 days

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setRefreshCookie(res: Response, refreshToken: string) {
    res.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
      path: '/',
    })
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(REFRESH_COOKIE, { path: '/' })
  }

  @Post('register')
  @ApiOperation({ summary: 'Neues Kundenkonto erstellen' })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.authService.register(dto)
    this.setRefreshCookie(res, tokens.refreshToken)
    return { success: true, data: { accessToken: tokens.accessToken } }
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Einloggen' })
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.login(dto, ip, userAgent)
    this.setRefreshCookie(res, tokens.refreshToken)
    return { success: true, data: { accessToken: tokens.accessToken } }
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Access Token erneuern (Cookie oder Body)' })
  async refresh(
    @Req() req: Request,
    @Body() body: { refreshToken?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    // Read from cookie first, fallback to body
    const refreshToken = req.cookies?.[REFRESH_COOKIE] ?? body?.refreshToken
    if (!refreshToken) {
      return { success: false, message: 'No refresh token' }
    }
    const tokens = await this.authService.refreshTokens(refreshToken)
    this.setRefreshCookie(res, tokens.refreshToken)
    return { success: true, data: { accessToken: tokens.accessToken } }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ausloggen' })
  async logout(@Res({ passthrough: true }) res: Response) {
    this.clearRefreshCookie(res)
    return { success: true }
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
  async resetPassword(@Body() body: { token: string; password: string }) {
    await this.authService.resetPassword(body.token, body.password)
    return { success: true, message: 'Passwort erfolgreich geändert. Bitte erneut einloggen.' }
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Aktuellen Benutzer abrufen' })
  async me(@CurrentUser() user: any) {
    return { success: true, data: user }
  }

  // ── Google OAuth ────────────────────────────────────────

  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth Login' })
  googleLogin() {
    // Redirects to Google
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Req() req: any, @Res() res: Response) {
    const googleUser = req.user
    const result = await this.authService.googleLogin(googleUser)
    const frontendUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    // Set cookie and redirect with only accessToken
    this.setRefreshCookie(res, result.refreshToken)
    res.redirect(
      `${frontendUrl}/auth/google/callback?accessToken=${result.accessToken}`,
    )
  }

  // ── Guest Account Creation via Token ────────────────────
  // GET /auth/create-account?token=xxx → returns pre-filled data
  @Get('create-account')
  @HttpCode(HttpStatus.OK)
  async getGuestInvite(@Query('token') token: string) {
    if (!token) throw new NotFoundException('Token required')
    // Find order with this invite token in notes
    const orders = await this.authService['prisma'].order.findMany({
      where: { deletedAt: null }, select: { id: true, notes: true, guestEmail: true },
      orderBy: { createdAt: 'desc' }, take: 100,
    })
    const match = orders.find((o: any) => {
      try { const n = JSON.parse(o.notes ?? '{}'); return n.inviteToken === token } catch { return false }
    })
    if (!match) throw new NotFoundException('Invalid or expired token')
    const notes = JSON.parse(match.notes ?? '{}')
    return { email: match.guestEmail ?? '', firstName: notes.guestFirstName ?? '', lastName: notes.guestLastName ?? '' }
  }

  // POST /auth/create-account → creates account + assigns guest orders
  @Post('create-account')
  @HttpCode(HttpStatus.CREATED)
  async createGuestAccount(
    @Body('token') token: string,
    @Body('password') password: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!token || !password) throw new NotFoundException('Token and password required')
    const prisma = this.authService['prisma']
    const orders = await prisma.order.findMany({
      where: { deletedAt: null }, select: { id: true, notes: true, guestEmail: true },
      orderBy: { createdAt: 'desc' }, take: 100,
    })
    const match = orders.find((o: any) => {
      try { return JSON.parse(o.notes ?? '{}').inviteToken === token } catch { return false }
    })
    if (!match) throw new NotFoundException('Invalid or expired token')

    const notes = JSON.parse(match.notes ?? '{}')
    const email = match.guestEmail
    if (!email) throw new NotFoundException('No email found')

    // Register via existing auth service
    const result = await this.authService.register({
      email, password,
      firstName: notes.guestFirstName || 'Guest',
      lastName: notes.guestLastName || '-',
      gdprConsent: true,
    })

    // Find the new user to get their ID
    const newUser = await prisma.user.findUnique({ where: { email }, select: { id: true, firstName: true, lastName: true, email: true } })

    // Assign ALL guest orders with this email to the new user
    if (newUser) {
      await prisma.order.updateMany({
        where: { guestEmail: { equals: email, mode: 'insensitive' }, userId: null },
        data: { userId: newUser.id },
      })
    }

    // Remove invite token
    delete notes.inviteToken
    await prisma.order.update({ where: { id: match.id }, data: { notes: JSON.stringify(notes) } })

    // Set refresh cookie + return tokens
    this.setRefreshCookie(res, result.refreshToken)
    return { accessToken: result.accessToken }
  }
}
