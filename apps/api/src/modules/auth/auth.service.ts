import {
  Injectable,
  Logger,
  Optional,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import * as bcrypt from 'bcrypt'
import * as crypto from 'crypto'
import { randomUUID } from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { EmailService } from '../email/email.service'
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'
import { AuthTokens } from '@omnichannel/types'

const MAX_LOGIN_ATTEMPTS = 5
const LOCK_DURATION_MINUTES = 15
const PASSWORD_RESET_EXPIRES_MINUTES = 15
const BCRYPT_ROUNDS = 12

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
    // Optional so unit-test TestingModules that don't provide the
    // webhook module still resolve AuthService. When undefined, the
    // optional-chain calls below become no-ops.
    @Optional() private readonly webhookDispatcher?: WebhookDispatcherService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokens> {
    if (!dto.gdprConsent) {
      throw new BadRequestException('GDPR-Einwilligung ist erforderlich')
    }

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (existing) {
      throw new ConflictException('Diese E-Mail-Adresse ist bereits registriert')
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS)

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase().trim(),
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        preferredLang: dto.preferredLang ?? 'de',
        gdprConsents: {
          create: {
            consentType: 'data_processing',
            isGranted: true,
            grantedAt: new Date(),
            consentVersion: '1.0',
            ipAddress: 'unknown', // wird im Controller gesetzt
            source: 'registration',
          },
        },
      },
    })

    // Generate email verification token
    const verifyToken = randomUUID()
    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerifyToken: verifyToken, emailVerifyExpires: new Date(Date.now() + 24 * 60 * 60 * 1000) }, // 24h
    })

    // Queue verification email (non-blocking).
    // Path-based URL (not ?token=...) so email click-trackers (Resend,
    // Gmail, Outlook Safe Links) cannot strip the token. Path segments
    // survive every tracker; query strings can get re-encoded or dropped.
    const lang = user.preferredLang ?? 'de'
    const verifyUrl = `${this.config.get('FRONTEND_URL') ?? 'http://localhost:3000'}/${lang}/auth/verify-email/${verifyToken}`
    await this.emailService.queueEmailVerification(user.email, lang, user.firstName, verifyUrl).catch(() => {})

    this.logger.log(`Email verification link for ${user.email}: ${verifyUrl}`)

    // Fire-and-forget webhook emit — never awaited, never throws.
    // Dispatcher has its own internal try/catch; we also guard with .catch()
    // as belt-and-suspenders. If the webhook module isn't provided (unit
    // tests), dispatcher is undefined and this is a no-op.
    this.webhookDispatcher
      ?.emit('customer.registered', {
        userId: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        locale: (user.preferredLang as 'de' | 'en' | 'ar') ?? 'de',
        provider: 'password',
        registeredAt: user.createdAt.toISOString(),
      })
      .catch((err) => this.logger.warn(`customer.registered webhook failed: ${err?.message ?? err}`))

    return this.generateTokens(user.id, user.email, user.role)
  }

  /**
   * Claim a stub guest account via the invite-token flow.
   * The user row already exists (passwordHash=null). We set the password,
   * mark the account as verified+active, and issue a login session.
   *
   * The caller (auth.controller.ts POST /create-account) is responsible for
   * verifying the invite token against the matching order before calling.
   */
  async claimGuestAccount(
    userId: string,
    password: string,
    patch?: { firstName?: string; lastName?: string },
  ): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new BadRequestException('Benutzer nicht gefunden')
    if (user.passwordHash) {
      throw new ConflictException('Konto bereits aktiviert — bitte einloggen')
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        isVerified: true,
        isActive: true,
        firstName: patch?.firstName?.trim() || user.firstName,
        lastName: patch?.lastName?.trim() || user.lastName,
        lastLoginAt: new Date(),
      },
    })

    this.logger.log(`Guest account claimed: ${updated.email} → ${updated.id}`)
    return this.generateTokens(updated.id, updated.email, updated.role)
  }

  async login(
    dto: LoginDto,
    ipAddress: string,
    userAgent?: string,
  ): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase(), deletedAt: null },
    })

    // Sicherheit: Gleiche Fehlermeldung wenn User nicht existiert
    // (keine Email-Enumeration ermöglichen).
    if (!user) {
      throw new UnauthorizedException('E-Mail oder Passwort falsch')
    }

    // Admin-Blockade zuerst prüfen — vor allen anderen Checks, damit auch
    // OAuth-User (Google/Facebook) ohne passwordHash die korrekte Block-
    // Nachricht sehen. Ohne diese Reihenfolge fallen passwordless User
    // in den 401-Pfad unten und sehen nur "E-Mail oder Passwort falsch".
    if (user.isBlocked) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'AccountBlocked',
        message: {
          de: 'Dein Konto wurde vom Kundenservice gesperrt. Bitte kontaktiere uns für weitere Informationen.',
          en: 'Your account has been blocked by customer service. Please contact us for more information.',
          ar: 'تم حظر حسابك من قبل خدمة العملاء. يرجى التواصل معنا للمزيد من المعلومات.',
        },
      })
    }

    // Passwordless accounts (OAuth stub, Google/Facebook) können sich nicht
    // per Passwort einloggen — nur via Social-Login-Button. Gleiche Meldung
    // wie falsches Passwort, um nicht zu verraten welches Konto OAuth ist.
    if (!user.passwordHash) {
      throw new UnauthorizedException('E-Mail oder Passwort falsch')
    }

    // Kontosperrung prüfen (temporäre Auto-Lock nach zu vielen Fehlversuchen)
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000)
      throw new ForbiddenException(
        `Konto gesperrt. Bitte warten Sie ${minutesLeft} Minuten.`,
      )
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash)

    if (!isPasswordValid) {
      const newAttempts = user.loginAttempts + 1
      const isAdmin = ['admin', 'super_admin'].includes(user.role)

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          loginAttempts: newAttempts,
          lockedUntil:
            newAttempts >= MAX_LOGIN_ATTEMPTS
              ? new Date(Date.now() + LOCK_DURATION_MINUTES * 60000)
              : null,
        },
      })

      // Audit log for failed admin login
      if (isAdmin) {
        await this.prisma.adminAuditLog.create({
          data: {
            adminId: user.id,
            action: 'ADMIN_LOGIN_FAILED',
            entityType: 'auth',
            entityId: user.id,
            changes: { ip: ipAddress, userAgent, attempt: newAttempts, success: false },
            ipAddress,
          },
        }).catch(() => {})

        this.logger.warn(`Admin login FAILED: ${user.email} | attempt ${newAttempts} | IP: ${ipAddress}`)

        // Alert main admin after 3 failed attempts
        if (newAttempts >= 3) {
          const mainAdmin = await this.prisma.user.findFirst({
            where: { role: 'super_admin', isActive: true, deletedAt: null },
            orderBy: { createdAt: 'asc' },
            select: { email: true, firstName: true, preferredLang: true },
          })
          if (mainAdmin) {
            this.emailService.queueAdminAlert(
              mainAdmin.email,
              mainAdmin.preferredLang ?? 'de',
              `Sicherheitswarnung: ${newAttempts} fehlgeschlagene Login-Versuche für Admin "${user.email}" von IP ${ipAddress}`,
            ).catch(() => {})
          }
        }
      }

      if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
        throw new ForbiddenException(
          `Konto gesperrt nach ${MAX_LOGIN_ATTEMPTS} fehlgeschlagenen Versuchen. Gesperrt für ${LOCK_DURATION_MINUTES} Minuten.`,
        )
      }

      throw new UnauthorizedException('E-Mail oder Passwort falsch')
    }

    if (!user.isActive) {
      throw new ForbiddenException('Konto deaktiviert. Bitte Kontakt aufnehmen.')
    }

    // Erfolgreicher Login — Zähler zurücksetzen + lastLoginAt tracken
    await this.prisma.user.update({
      where: { id: user.id },
      data: { loginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    })

    return this.generateTokens(user.id, user.email, user.role, { ipAddress, userAgent })
  }

  async refreshTokens(token: string): Promise<AuthTokens> {
    const tokenHash = this.hashToken(token)

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    })

    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Ungültiger oder abgelaufener Refresh Token')
    }

    // Grace period: if token was revoked recently, allow reuse
    // This prevents race conditions during rapid page refreshes (F5)
    if (stored.isRevoked) {
      // Token was created at createdAt. If it was revoked very recently
      // (within last 15s based on lastUsedAt or fallback), allow reuse
      const lastUsed = stored.lastUsedAt?.getTime() ?? stored.createdAt.getTime()
      const gracePeriodMs = 15_000
      if (Date.now() - lastUsed > gracePeriodMs) {
        throw new UnauthorizedException('Ungültiger oder abgelaufener Refresh Token')
      }
      this.logger.debug(`Refresh grace period: token reused within 15s for user ${stored.user.email}`)
      return this.generateTokens(stored.user.id, stored.user.email, stored.user.role)
    }

    // Token Rotation — revoke old token (but it stays valid for grace period via lastUsedAt)
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { isRevoked: true, lastUsedAt: new Date() },
    })

    return this.generateTokens(stored.user.id, stored.user.email, stored.user.role)
  }

  async requestPasswordReset(email: string): Promise<void> {
    // Sicherheit: Immer gleiche Antwort, egal ob Email existiert
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase(), deletedAt: null },
    })

    if (!user) return // Kein Fehler — sicherheitshalber

    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = this.hashToken(rawToken)

    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_EXPIRES_MINUTES * 60000),
      },
    })

    // Password reset email (non-blocking via BullMQ, rate limited: 3/hour)
    const lang = user.preferredLang ?? 'de'
    await this.emailService.queuePasswordReset(
      user.email, lang, user.firstName, user.id, rawToken,
    ).catch(() => {})
  }

  async verifyEmail(token: string): Promise<{ success: boolean; email: string }> {
    const user = await this.prisma.user.findFirst({
      where: { emailVerifyToken: token, emailVerifyExpires: { gt: new Date() } },
    })

    if (!user) {
      throw new BadRequestException('Verifizierungslink ungültig oder abgelaufen.')
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { isVerified: true, emailVerifyToken: null, emailVerifyExpires: null },
    })

    this.logger.log(`Email verified: ${user.email}`)
    return { success: true, email: user.email }
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new BadRequestException('User not found')
    if (user.isVerified) throw new BadRequestException('Already verified')

    const verifyToken = randomUUID()
    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerifyToken: verifyToken, emailVerifyExpires: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    })

    const lang = user.preferredLang ?? 'de'
    const verifyUrl = `${this.config.get('FRONTEND_URL') ?? 'http://localhost:3000'}/${lang}/auth/verify-email/${verifyToken}`
    await this.emailService.queueEmailVerification(user.email, lang, user.firstName, verifyUrl).catch(() => {})
    this.logger.log(`Resent verification for ${user.email}: ${verifyUrl}`)
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenHash = this.hashToken(token)

    const reset = await this.prisma.passwordReset.findUnique({ where: { tokenHash } })

    if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
      throw new BadRequestException('Link ungültig oder abgelaufen. Bitte neuen anfordern.')
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)

    // Get user info before reset (for audit)
    const user = await this.prisma.user.findUnique({
      where: { id: reset.userId },
      select: { id: true, email: true, role: true, firstName: true },
    })

    await this.prisma.$transaction([
      // Token als verwendet markieren
      this.prisma.passwordReset.update({
        where: { id: reset.id },
        data: { usedAt: new Date() },
      }),
      // Passwort aktualisieren + Login-Sperre aufheben
      this.prisma.user.update({
        where: { id: reset.userId },
        data: { passwordHash, loginAttempts: 0, lockedUntil: null },
      }),
      // Alle Refresh Tokens widerrufen (von allen Geräten abmelden)
      this.prisma.refreshToken.updateMany({
        where: { userId: reset.userId },
        data: { isRevoked: true },
      }),
    ])

    // Audit + Notification for admin password resets
    if (user && ['admin', 'super_admin', 'warehouse_staff'].includes(user.role)) {
      this.logger.warn(`ADMIN PASSWORD RESET: ${user.email} (${user.role})`)

      await this.prisma.adminAuditLog.create({
        data: {
          adminId: user.id,
          action: 'ADMIN_PASSWORD_RESET',
          entityType: 'auth',
          entityId: user.id,
          changes: { email: user.email, role: user.role, method: 'email_link' },
          ipAddress: '::reset',
        },
      }).catch(() => {})

      // Notify super_admin(s) about this reset
      const superAdmins = await this.prisma.user.findMany({
        where: { role: 'super_admin', isActive: true, deletedAt: null, id: { not: user.id } },
        select: { id: true },
      })
      for (const sa of superAdmins) {
        await this.prisma.notification.create({
          data: {
            // Typed notification so the frontend bell can render it in
            // the viewing admin's locale instead of showing the raw
            // German fallback we persist as title/body.
            type: 'admin_password_reset',
            title: `Admin-Passwort zurückgesetzt: ${user.email}`,
            body: `${user.firstName ?? user.email} hat das Passwort per E-Mail-Link zurückgesetzt.`,
            channel: 'admin',
            userId: sa.id,
            data: {
              email: user.email,
              name: user.firstName ?? user.email,
              resetBy: 'email_link',
            },
          },
        }).catch(() => {})
      }
    }
  }

  private async generateTokens(
    userId: string,
    email: string,
    role: string,
    meta?: { ipAddress?: string; userAgent?: string; deviceName?: string },
  ): Promise<AuthTokens> {
    const isAdmin = ['admin', 'super_admin', 'warehouse_staff'].includes(role)
    const payload = { sub: userId, email, role }

    // Admin: shorter access token (15 min same), shorter refresh token (8h vs 7d)
    const accessToken = this.jwt.sign(payload)

    // Refresh Token erstellen und in DB speichern
    const rawRefreshToken = crypto.randomBytes(64).toString('hex')
    const refreshTokenHash = this.hashToken(rawRefreshToken)
    const refreshDuration = isAdmin ? 8 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000 // Admin: 8h, Customer: 7d
    const expiresAt = new Date(Date.now() + refreshDuration)

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: refreshTokenHash,
        expiresAt,
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
        deviceName: meta?.deviceName,
        lastUsedAt: new Date(),
      },
    })

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: 15 * 60, // 15 Minuten in Sekunden
    }
  }

  // ── Google OAuth ─────────────────────────────────────────

  async googleLogin(googleUser: {
    email: string
    firstName: string
    lastName: string
    profileImageUrl?: string
    providerAccountId?: string
  }): Promise<{ accessToken: string; refreshToken: string }> {
    // Find or create user
    let user = await this.prisma.user.findUnique({
      where: { email: googleUser.email },
    })

    if (!user) {
      // Auto-create account
      user = await this.prisma.user.create({
        data: {
          email: googleUser.email,
          firstName: googleUser.firstName,
          lastName: googleUser.lastName,
          profileImageUrl: googleUser.profileImageUrl,
          isVerified: true, // Google already verified the email
          role: 'customer',
          gdprConsents: {
            create: {
              consentType: 'data_processing',
              isGranted: true,
              grantedAt: new Date(),
              consentVersion: '1.0',
              ipAddress: 'google-oauth',
              source: 'registration',
            },
          },
        },
      })
      this.logger.log(`New Google user created: ${user.email}`)
    }

    // Ensure the OauthAccount link exists so the admin dashboard knows this
    // is a Google login and not a passwordless guest. Idempotent upsert on
    // the unique [provider, providerAccountId] constraint.
    if (googleUser.providerAccountId) {
      await this.prisma.oauthAccount.upsert({
        where: {
          provider_providerAccountId: {
            provider: 'google',
            providerAccountId: googleUser.providerAccountId,
          },
        },
        create: {
          userId: user.id,
          provider: 'google',
          providerAccountId: googleUser.providerAccountId,
        },
        update: {}, // nothing to change on re-login
      }).catch((e) => {
        this.logger.warn(`OauthAccount upsert failed for ${user!.email}: ${(e as Error).message}`)
      })
    }

    // Same structured error as /auth/login so the OAuth-callback can detect
    // a block specifically and redirect to the friendly message screen.
    if (user.isBlocked) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'AccountBlocked',
        message: {
          de: 'Dein Konto wurde vom Kundenservice gesperrt. Bitte kontaktiere uns für weitere Informationen.',
          en: 'Your account has been blocked by customer service. Please contact us for more information.',
          ar: 'تم حظر حسابك من قبل خدمة العملاء. يرجى التواصل معنا للمزيد من المعلومات.',
        },
      })
    }

    // Generate tokens
    const accessToken = this.jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
    )
    const refreshToken = crypto.randomBytes(32).toString('hex')

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    return { accessToken, refreshToken }
  }

  // ── Generic Social Login (Facebook, Apple, etc.) ──────────

  async socialLogin(socialUser: {
    email: string
    firstName: string
    lastName: string
    profileImageUrl?: string
    provider?: string
    providerAccountId?: string
  }): Promise<{ accessToken: string; refreshToken: string }> {
    if (!socialUser.email) {
      throw new UnauthorizedException('E-Mail wird benötigt für die Anmeldung')
    }

    let user = await this.prisma.user.findUnique({
      where: { email: socialUser.email },
    })

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: socialUser.email,
          firstName: socialUser.firstName,
          lastName: socialUser.lastName,
          profileImageUrl: socialUser.profileImageUrl,
          isVerified: true,
          role: 'customer',
          gdprConsents: {
            create: {
              consentType: 'data_processing',
              isGranted: true,
              grantedAt: new Date(),
              consentVersion: '1.0',
              ipAddress: `${socialUser.provider ?? 'social'}-oauth`,
              source: 'registration',
            },
          },
        },
      })
      this.logger.log(`New ${socialUser.provider ?? 'social'} user created: ${user.email}`)
    }

    // Mirror googleLogin: upsert OauthAccount so admin isGuest detection
    // correctly identifies this as a social login, not a stub guest.
    if (socialUser.provider && socialUser.providerAccountId) {
      await this.prisma.oauthAccount.upsert({
        where: {
          provider_providerAccountId: {
            provider: socialUser.provider,
            providerAccountId: socialUser.providerAccountId,
          },
        },
        create: {
          userId: user.id,
          provider: socialUser.provider,
          providerAccountId: socialUser.providerAccountId,
        },
        update: {},
      }).catch((e) => {
        this.logger.warn(`OauthAccount upsert failed for ${user!.email}: ${(e as Error).message}`)
      })
    }

    // Same structured error as login() and googleLogin() — keeps the OAuth
    // callback handler able to detect a block and redirect to the friendly
    // screen instead of the generic "Login fehlgeschlagen".
    if (user.isBlocked) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'AccountBlocked',
        message: {
          de: 'Dein Konto wurde vom Kundenservice gesperrt. Bitte kontaktiere uns für weitere Informationen.',
          en: 'Your account has been blocked by customer service. Please contact us for more information.',
          ar: 'تم حظر حسابك من قبل خدمة العملاء. يرجى التواصل معنا للمزيد من المعلومات.',
        },
      })
    }

    const accessToken = this.jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
    )
    const refreshToken = crypto.randomBytes(32).toString('hex')

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    return { accessToken, refreshToken }
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex')
  }
}
