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
  Logger,
  UseFilters,
} from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { Request, Response } from 'express'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { AuthService } from './auth.service'
import { AuthTokens } from '@omnichannel/types'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { PrismaService } from '../../prisma/prisma.service'
import { OAuthRedirectFilter } from './guards/google-oauth.guard'
import {
  adminCookieOptions,
  customerCookieOptions,
} from '../../common/helpers/cookie-options'

// ── Separate cookies for Admin vs Customer ──────────────────
const ADMIN_COOKIE = 'malak_admin_rt'
const CUSTOMER_COOKIE = 'malak_customer_rt'
// Legacy cookie name from before the Admin/Customer split. The current
// code never sets it, but older browsers still carry it around from
// pre-split sessions. We clear it on every login AND every logout so
// it is guaranteed to disappear from every active browser over time.
// Safe to remove this constant once zero users still have the cookie —
// check devtools across a few sessions a month from now.
const LEGACY_COOKIE = 'malak_refresh'

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name)

  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Cookie helpers ──────────────────────────────────────────

  private setAdminCookie(res: Response, refreshToken: string) {
    res.cookie(ADMIN_COOKIE, refreshToken, adminCookieOptions())
    // Housekeeping: kill the legacy malak_refresh cookie on every login
    // so browsers that carry it from pre-split sessions get cleaned up.
    res.clearCookie(LEGACY_COOKIE, { path: '/' })
  }

  private setCustomerCookie(res: Response, refreshToken: string) {
    res.cookie(CUSTOMER_COOKIE, refreshToken, customerCookieOptions())
    res.clearCookie(LEGACY_COOKIE, { path: '/' })
  }

  private clearAdminCookie(res: Response) {
    // Match options on clear, otherwise some browsers (esp. Safari) refuse
    // to delete a cookie that was set with sameSite=none + secure.
    const { maxAge, ...opts } = adminCookieOptions()
    res.clearCookie(ADMIN_COOKIE, opts)
    res.clearCookie(LEGACY_COOKIE, { path: '/' })
  }

  private clearCustomerCookie(res: Response) {
    const { maxAge, ...opts } = customerCookieOptions()
    res.clearCookie(CUSTOMER_COOKIE, opts)
    res.clearCookie(LEGACY_COOKIE, { path: '/' })
  }

  // ── Register (always customer) ──────────────────────────────

  @Post('register')
  @Throttle({ short: { limit: 3, ttl: 600000 } }) // 3 registrations per 10 minutes per IP
  @ApiOperation({ summary: 'Neues Kundenkonto erstellen' })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.authService.register(dto)
    this.setCustomerCookie(res, tokens.refreshToken)
    return { success: true, data: { accessToken: tokens.accessToken, tokenType: 'customer' } }
  }

  // ── Login (cookie based on loginContext, NOT role) ──────────

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Einloggen' })
  async login(
    @Body() dto: LoginDto & { loginContext?: 'admin' | 'shop' },
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.login(dto, ip, userAgent)

    // loginContext decides which cookie — NOT the role
    const wantsAdmin = dto.loginContext === 'admin'

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      select: { id: true, role: true, email: true },
    })

    const isAdmin = user && ['admin', 'super_admin'].includes(user.role)

    if (wantsAdmin) {
      this.setAdminCookie(res, tokens.refreshToken)

      // Audit log for admin login
      if (isAdmin) {
        await this.prisma.adminAuditLog.create({
          data: {
            adminId: user.id,
            action: 'ADMIN_LOGIN',
            entityType: 'auth',
            entityId: user.id,
            changes: { ip, userAgent, success: true },
            ipAddress: ip,
          },
        }).catch(() => {})
        this.logger.log(`Admin login: ${user.email} from ${ip}`)
      }
    } else {
      this.setCustomerCookie(res, tokens.refreshToken)
    }

    return {
      success: true,
      data: {
        accessToken: tokens.accessToken,
        tokenType: wantsAdmin ? 'admin' : 'customer',
        role: user?.role,
      },
    }
  }

  // ── Refresh (reads from correct cookie) ─────────────────────

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Access Token erneuern' })
  async refresh(
    @Req() req: Request,
    @Body() body: { refreshToken?: string; tokenType?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const adminToken = req.cookies?.[ADMIN_COOKIE]
    const customerToken = req.cookies?.[CUSTOMER_COOKIE]
    const bodyToken = body?.refreshToken

    // If tokenType is specified, ONLY use that type — no fallback
    let refreshToken: string | undefined
    let isAdmin = false

    if (body?.tokenType === 'admin') {
      refreshToken = adminToken  // undefined if no admin cookie → will fail below
      isAdmin = true
    } else if (body?.tokenType === 'customer') {
      refreshToken = customerToken  // undefined if no customer cookie → will fail below
    } else {
      // No tokenType specified (legacy) — try customer first, then admin
      if (customerToken) {
        refreshToken = customerToken
      } else if (adminToken) {
        refreshToken = adminToken
        isAdmin = true
      } else {
        refreshToken = bodyToken
      }
    }

    if (!refreshToken) {
      return { success: false, message: 'No refresh token' }
    }

    const tokens = await this.authService.refreshTokens(refreshToken)

    if (isAdmin) {
      this.setAdminCookie(res, tokens.refreshToken)
    } else {
      this.setCustomerCookie(res, tokens.refreshToken)
    }

    return { success: true, data: { accessToken: tokens.accessToken, tokenType: isAdmin ? 'admin' : 'customer' } }
  }

  // ── Logout (clears correct cookie) ──────────────────────────

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ausloggen' })
  async logout(
    @Body() body: { tokenType?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    if (body?.tokenType === 'admin') {
      this.clearAdminCookie(res)
    } else if (body?.tokenType === 'customer') {
      this.clearCustomerCookie(res)
    } else {
      // Clear both if no type specified
      this.clearAdminCookie(res)
      this.clearCustomerCookie(res)
    }
    return { success: true }
  }

  // ── Forgot / Reset Password ─────────────────────────────────

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 3, ttl: 300000 } })
  @ApiOperation({ summary: 'Passwort-Reset anfordern' })
  async forgotPassword(@Body('email') email: string) {
    await this.authService.requestPasswordReset(email)
    return {
      success: true,
      message: 'Falls die E-Mail registriert ist, erhalten Sie eine Nachricht.',
    }
  }

  @Post('emergency-recovery')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 2, ttl: 600000 } }) // max 2 per 10 min
  @ApiOperation({ summary: 'Notfall-Passwort-Reset via Recovery-Email' })
  async emergencyRecovery(@Body('email') email: string, @Ip() ip: string) {
    // Find user with this recovery email
    const user = await this.prisma.user.findFirst({
      where: { recoveryEmail: email.toLowerCase(), role: 'super_admin', deletedAt: null },
      select: { id: true, email: true, firstName: true, recoveryEmail: true, preferredLang: true },
    })
    // Always same response (security)
    if (user) {
      await this.authService.requestPasswordReset(user.email)
      // Also send to recovery email
      this.logger.warn(`EMERGENCY RECOVERY requested for ${user.email} via ${user.recoveryEmail} from IP ${ip}`)
      await this.prisma.adminAuditLog.create({
        data: { adminId: user.id, action: 'EMERGENCY_RECOVERY', entityType: 'auth', entityId: user.id, changes: { ip, recoveryEmail: email }, ipAddress: ip },
      }).catch(() => {})
    }
    return { success: true, message: 'Falls eine Wiederherstellungs-E-Mail hinterlegt ist, erhalten Sie eine Nachricht.' }
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Passwort zurücksetzen' })
  async resetPassword(@Body() body: { token: string; password: string }) {
    await this.authService.resetPassword(body.token, body.password)
    return { success: true, message: 'Passwort erfolgreich geändert. Bitte erneut einloggen.' }
  }

  // ── Email Verification ──────────────────────────────────────

  @Get('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'E-Mail verifizieren via Token' })
  async verifyEmail(@Query('token') token: string) {
    return this.authService.verifyEmail(token)
  }

  @Post('resend-verification')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verifizierungs-E-Mail erneut senden' })
  async resendVerification(@CurrentUser() user: any) {
    await this.authService.resendVerification(user.id)
    return { success: true, message: 'Verifizierungs-E-Mail wurde erneut gesendet.' }
  }

  // ── Staff Invite Accept (no auth required) ──────────────────

  @Post('accept-invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mitarbeiter-Einladung annehmen' })
  async acceptStaffInvite(@Body() body: { token: string; firstName: string; lastName: string; password: string }) {
    const user = await this.prisma.user.findFirst({
      where: { inviteToken: body.token, inviteExpiresAt: { gt: new Date() } },
    })
    if (!user) throw new NotFoundException('Einladungslink ungültig oder abgelaufen')
    if (user.passwordHash) throw new NotFoundException('Einladung bereits angenommen')

    const bcryptMod = await import('bcrypt')
    const passwordHash = await bcryptMod.default.hash(body.password, 12)

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        firstName: body.firstName.trim(),
        lastName: body.lastName.trim(),
        passwordHash,
        isActive: true,
        isVerified: true,
        inviteToken: null,
        inviteExpiresAt: null,
      },
    })

    return { success: true, email: user.email }
  }

  // ── Me ──────────────────────────────────────────────────────

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Aktuellen Benutzer abrufen' })
  async me(@CurrentUser() user: any) {
    return { success: true, data: user }
  }

  // ── Google OAuth ────────────────────────────────────────────

  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth Login' })
  googleLogin() {
    // Redirects to Google
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @UseFilters(OAuthRedirectFilter)
  async googleCallback(@Req() req: any, @Res() res: Response) {
    const frontendUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    try {
      const result = await this.authService.googleLogin(req.user)
      this.setCustomerCookie(res, result.refreshToken)
      res.redirect(`${frontendUrl}/auth/google/callback?accessToken=${result.accessToken}`)
    } catch (err: any) {
      // Detect the structured AccountBlocked error so the login page can
      // render the friendly block screen with a support CTA.
      const body = err?.response ?? err?.getResponse?.() ?? null
      const errorCode = (typeof body === 'object' ? body?.error : null) ?? null
      const reason = errorCode === 'AccountBlocked' ? 'account_blocked' : 'google_failed'
      res.redirect(`${frontendUrl}/auth/login?error=${reason}`)
    }
  }

  // ── Facebook OAuth ──────────────────────────────────────────

  @Get('facebook')
  @UseGuards(AuthGuard('facebook'))
  @ApiOperation({ summary: 'Facebook OAuth Login' })
  facebookLogin() {
    // Redirects to Facebook
  }

  @Get('facebook/callback')
  @UseGuards(AuthGuard('facebook'))
  @UseFilters(OAuthRedirectFilter)
  async facebookCallback(@Req() req: any, @Res() res: Response) {
    const frontendUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    try {
      const result = await this.authService.socialLogin(req.user)
      this.setCustomerCookie(res, result.refreshToken)
      res.redirect(`${frontendUrl}/auth/facebook/callback?accessToken=${result.accessToken}`)
    } catch (err: any) {
      const body = err?.response ?? err?.getResponse?.() ?? null
      const errorCode = (typeof body === 'object' ? body?.error : null) ?? null
      const reason = errorCode === 'AccountBlocked' ? 'account_blocked' : 'facebook_failed'
      res.redirect(`${frontendUrl}/auth/login?error=${reason}`)
    }
  }

  // ── Guest Account Creation via Token ────────────────────────
  //
  // Two account shapes reach this endpoint:
  //   1. STUB-USER (the actual live pattern): orders.service.ts created a
  //      User row with passwordHash=null and linked it via order.userId.
  //      order.guestEmail is always null in this case.
  //   2. PURE GUEST (historical): order.userId=null, order.guestEmail=set.
  //
  // The old implementation only handled case 2 — throwing "No email found"
  // for every real stub-user invite. Both flows must work here.

  private async findOrderByInviteToken(token: string) {
    const orders = await this.prisma.order.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        notes: true,
        guestEmail: true,
        userId: true,
        user: { select: { id: true, email: true, firstName: true, lastName: true, passwordHash: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    for (const o of orders) {
      try {
        const n = JSON.parse(o.notes ?? '{}')
        if (n.inviteToken === token) return { order: o, notes: n }
      } catch {}
    }
    return null
  }

  @Get('create-account')
  @HttpCode(HttpStatus.OK)
  async getGuestInvite(@Query('token') token: string) {
    if (!token) throw new NotFoundException('Token required')
    const match = await this.findOrderByInviteToken(token)
    if (!match) throw new NotFoundException('Invalid or expired token')

    const { order, notes } = match
    // Prefer the stub user's data, fall back to guestEmail/notes for pure guests
    const email = order.user?.email ?? order.guestEmail ?? ''
    const firstName = order.user?.firstName ?? notes.guestFirstName ?? ''
    const lastName = order.user?.lastName ?? notes.guestLastName ?? ''
    const alreadyClaimed = !!order.user?.passwordHash

    if (!email) throw new NotFoundException('No email associated with this invite')

    return { email, firstName, lastName, alreadyClaimed }
  }

  @Post('create-account')
  @HttpCode(HttpStatus.CREATED)
  async createGuestAccount(
    @Body('token') token: string,
    @Body('password') password: string,
    @Body('firstName') firstName: string | undefined,
    @Body('lastName') lastName: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!token || !password) throw new NotFoundException('Token and password required')
    const match = await this.findOrderByInviteToken(token)
    if (!match) throw new NotFoundException('Invalid or expired token')

    const { order, notes } = match

    let result: AuthTokens
    let claimedUserId: string

    if (order.user && order.userId) {
      // CASE 1 — stub user already exists, just claim it
      if (order.user.passwordHash) {
        throw new NotFoundException('Konto bereits aktiviert — bitte einloggen')
      }
      result = await this.authService.claimGuestAccount(order.userId, password, { firstName, lastName })
      claimedUserId = order.userId
    } else {
      // CASE 2 — pure guest fallback (no user row linked to order)
      const email = order.guestEmail
      if (!email) throw new NotFoundException('No email associated with this invite')

      result = await this.authService.register({
        email,
        password,
        firstName: firstName?.trim() || notes.guestFirstName || 'Guest',
        lastName: lastName?.trim() || notes.guestLastName || '-',
        gdprConsent: true,
      })
      const newUser = await this.prisma.user.findUnique({ where: { email }, select: { id: true } })
      if (!newUser) throw new NotFoundException('User creation failed')
      claimedUserId = newUser.id

      // Link any other orphan orders with the same guestEmail to the new user
      await this.prisma.order.updateMany({
        where: { guestEmail: { equals: email, mode: 'insensitive' }, userId: null },
        data: { userId: newUser.id },
      })
    }

    // Remove the invite token so it cannot be reused
    delete notes.inviteToken
    await this.prisma.order.update({ where: { id: order.id }, data: { notes: JSON.stringify(notes) } })

    this.setCustomerCookie(res, result.refreshToken)
    this.logger.log(`Guest invite claimed via token: user=${claimedUserId} order=${order.id}`)
    return { accessToken: result.accessToken, tokenType: 'customer' }
  }
}
