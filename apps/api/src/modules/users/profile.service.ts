import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as bcrypt from 'bcrypt'
import * as crypto from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { StorageService } from '../../common/services/storage.service'
import { EmailService } from '../email/email.service'
import { EMAIL_TYPES } from '../email/email.constants'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { ChangePasswordDto } from './dto/change-password.dto'
import { ChangeEmailDto } from './dto/change-email.dto'
import { UserNotFoundException } from './exceptions/user-not-found.exception'
import { InvalidPasswordException } from './exceptions/invalid-password.exception'
import { ConflictException } from '@nestjs/common'

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
  ) {}

  async findMe(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, anonymizedAt: null },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        preferredLang: true,
        role: true,
        profileImageUrl: true,
        isVerified: true,
        twoFactorEnabled: true,
        lastLoginAt: true,
        createdAt: true,
      },
    })

    if (!user) throw new UserNotFoundException(userId)
    return user
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    await this.findMe(userId) // guard: user must exist

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.firstName !== undefined && { firstName: dto.firstName }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.preferredLang !== undefined && { preferredLang: dto.preferredLang }),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        preferredLang: true,
        profileImageUrl: true,
        updatedAt: true,
      },
    })
  }

  async uploadProfileImage(userId: string, file: Express.Multer.File): Promise<string> {
    await this.findMe(userId)

    // Upload to Supabase Storage (optimized WebP 400x400)
    const url = await this.storage.uploadAvatar(userId, file.buffer)

    await this.prisma.user.update({
      where: { id: userId },
      data: { profileImageUrl: url },
    })

    this.logger.log(`Profile image updated for user ${userId}`)
    return url
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { passwordHash: true },
    })
    if (!user) throw new UserNotFoundException(userId)
    if (!user.passwordHash) throw new InvalidPasswordException()

    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash)
    if (!valid) throw new InvalidPasswordException()

    const newHash = await bcrypt.hash(dto.newPassword, 12)
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: newHash },
      }),
      // Revoke all existing refresh tokens for security
      this.prisma.refreshToken.updateMany({
        where: { userId, isRevoked: false },
        data: { isRevoked: true },
      }),
    ])

    this.logger.log(`Password changed for user ${userId} — all sessions revoked`)
  }

  async requestEmailChange(userId: string, dto: ChangeEmailDto): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { passwordHash: true, email: true, firstName: true, preferredLang: true },
    })
    if (!user) throw new UserNotFoundException(userId)
    if (!user.passwordHash) throw new InvalidPasswordException()

    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash)
    if (!valid) throw new InvalidPasswordException()

    // Check email uniqueness
    const existing = await this.prisma.user.findUnique({ where: { email: dto.newEmail } })
    if (existing) {
      throw new ConflictException({
        statusCode: 409,
        error: 'EmailAlreadyInUse',
        message: {
          de: 'Diese E-Mail-Adresse ist bereits vergeben.',
          en: 'This email address is already in use.',
          ar: 'عنوان البريد الإلكتروني مستخدم بالفعل.',
        },
      })
    }

    const token = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    await this.prisma.emailChangeRequest.create({
      data: {
        userId,
        newEmail: dto.newEmail,
        tokenHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
      },
    })

    // Send verification email to the NEW address
    const appUrl = this.config.get<string>('APP_URL') ?? 'http://localhost:3000'
    const lang = (user.preferredLang as string) ?? 'de'
    const expiresInLabel = lang === 'ar' ? '24 ساعة' : lang === 'en' ? '24 hours' : '24 Stunden'
    try {
      await this.emailService.enqueue({
        to: dto.newEmail,
        type: EMAIL_TYPES.EMAIL_CHANGE,
        lang,
        data: {
          firstName: user.firstName ?? '',
          confirmUrl: `${appUrl}/${lang}/account/confirm-email?token=${token}`,
          expiresIn: expiresInLabel,
        },
      })
    } catch (e) {
      this.logger.error(
        `Failed to enqueue email-change verification for user ${userId}: ${(e as Error).message}`,
      )
      // Don't leak failure to client — the DB record was created and the user can retry.
    }
    this.logger.log(`Email change requested for user ${userId} → ${dto.newEmail}`)
  }

  async confirmEmailChange(token: string): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    const request = await this.prisma.emailChangeRequest.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    })

    if (!request) {
      throw new ConflictException({
        statusCode: 409,
        error: 'InvalidOrExpiredToken',
        message: {
          de: 'Der Bestätigungslink ist ungültig oder abgelaufen.',
          en: 'The confirmation link is invalid or expired.',
          ar: 'رابط التأكيد غير صالح أو منتهي الصلاحية.',
        },
      })
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: request.userId },
        data: { email: request.newEmail },
      }),
      this.prisma.emailChangeRequest.update({
        where: { id: request.id },
        data: { usedAt: new Date() },
      }),
    ])

    this.logger.log(`Email changed for user ${request.userId} → ${request.newEmail}`)
  }

  async updateLastLogin(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    })
  }
}
