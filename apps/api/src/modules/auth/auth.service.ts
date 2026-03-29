import {
  Injectable,
  Logger,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import * as crypto from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { EmailService } from '../email/email.service'
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

    // Welcome + E-Mail-Verifizierung (non-blocking via BullMQ)
    const lang = user.preferredLang ?? 'de'
    await this.emailService.queueWelcome(user.email, lang, user.firstName).catch(() => {})

    return this.generateTokens(user.id, user.email, user.role)
  }

  async login(
    dto: LoginDto,
    ipAddress: string,
    userAgent?: string,
  ): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase(), deletedAt: null },
    })

    // Sicherheit: Gleiche Fehlermeldung, egal ob User existiert oder nicht
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('E-Mail oder Passwort falsch')
    }

    // Kontosperrung prüfen
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000)
      throw new ForbiddenException(
        `Konto gesperrt. Bitte warten Sie ${minutesLeft} Minuten.`,
      )
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash)

    if (!isPasswordValid) {
      const newAttempts = user.loginAttempts + 1

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

    if (!stored || stored.isRevoked || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Ungültiger oder abgelaufener Refresh Token')
    }

    // Token Rotation — alten Token widerrufen
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { isRevoked: true },
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

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenHash = this.hashToken(token)

    const reset = await this.prisma.passwordReset.findUnique({ where: { tokenHash } })

    if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
      throw new BadRequestException('Link ungültig oder abgelaufen. Bitte neuen anfordern.')
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)

    await this.prisma.$transaction([
      // Token als verwendet markieren
      this.prisma.passwordReset.update({
        where: { id: reset.id },
        data: { usedAt: new Date() },
      }),
      // Passwort aktualisieren
      this.prisma.user.update({
        where: { id: reset.userId },
        data: { passwordHash },
      }),
      // Alle Refresh Tokens widerrufen (von allen Geräten abmelden)
      this.prisma.refreshToken.updateMany({
        where: { userId: reset.userId },
        data: { isRevoked: true },
      }),
    ])
  }

  private async generateTokens(
    userId: string,
    email: string,
    role: string,
    meta?: { ipAddress?: string; userAgent?: string; deviceName?: string },
  ): Promise<AuthTokens> {
    const payload = { sub: userId, email, role }

    const accessToken = this.jwt.sign(payload)

    // Refresh Token erstellen und in DB speichern
    const rawRefreshToken = crypto.randomBytes(64).toString('hex')
    const refreshTokenHash = this.hashToken(rawRefreshToken)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

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

    if (user.isBlocked) {
      throw new UnauthorizedException('Account blocked')
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

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex')
  }
}
