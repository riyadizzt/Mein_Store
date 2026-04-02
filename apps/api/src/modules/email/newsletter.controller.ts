import {
  Controller, Post, Body, HttpCode, HttpStatus, Logger,
  BadRequestException, ConflictException,
} from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { IsEmail, IsOptional, IsIn } from 'class-validator'
import { PrismaService } from '../../prisma/prisma.service'
import { EmailService } from './email.service'

// ── DTO ────────────────────────────────────────────────────────

class NewsletterSubscribeDto {
  @IsEmail({}, {
    message: JSON.stringify({
      de: 'Ungültige E-Mail-Adresse',
      en: 'Invalid email address',
      ar: 'عنوان بريد إلكتروني غير صالح',
    }),
  })
  email!: string

  @IsOptional()
  @IsIn(['de', 'en', 'ar'])
  locale?: string
}

// ── Controller ─────────────────────────────────────────────────

@ApiTags('Newsletter')
@Controller('newsletter')
export class NewsletterController {
  private readonly logger = new Logger(NewsletterController.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  @Post('subscribe')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Newsletter abonnieren & Willkommensgutschein erhalten' })
  async subscribe(@Body() dto: NewsletterSubscribeDto) {
    const email = dto.email.toLowerCase().trim()
    const locale = dto.locale ?? 'de'

    // ── 0. Check if welcome popup is enabled ──────────────────
    const setting = await this.prisma.shopSetting.findUnique({ where: { key: 'welcomePopupEnabled' } })
    if (setting?.value === 'false') {
      throw new BadRequestException({
        de: 'Newsletter-Anmeldung ist derzeit deaktiviert.',
        en: 'Newsletter subscription is currently disabled.',
        ar: 'الاشتراك في النشرة معطل حالياً.',
      })
    }

    // ── 1. Validate email format (redundant safety net) ────────
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException({
        de: 'Ungültige E-Mail-Adresse',
        en: 'Invalid email address',
        ar: 'عنوان بريد إلكتروني غير صالح',
      })
    }

    // ── 2. Check if a WELCOME coupon already exists for this email
    const existingCoupon = await this.prisma.coupon.findFirst({
      where: {
        code: { startsWith: 'WELCOME-' },
        description: { contains: email },
      },
    })

    if (existingCoupon) {
      throw new ConflictException({
        de: 'Du hast bereits einen Willkommensgutschein erhalten.',
        en: 'You have already received a welcome coupon.',
        ar: 'لقد حصلت بالفعل على قسيمة ترحيبية.',
      })
    }

    // ── 3. Generate unique coupon code ─────────────────────────
    const randomChars = Array.from({ length: 6 }, () =>
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.charAt(
        Math.floor(Math.random() * 36),
      ),
    ).join('')
    const couponCode = `WELCOME-${randomChars}`

    // ── 4. Create coupon in DB ─────────────────────────────────
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 30)

    await this.prisma.coupon.create({
      data: {
        code: couponCode,
        type: 'percentage',
        discountPercent: 10,
        onePerCustomer: true,
        maxUsageCount: 1,
        expiresAt,
        description: `10% Willkommensrabatt / 10% Welcome discount / خصم ترحيبي 10% [${email}]`,
        isActive: true,
      },
    })

    this.logger.log(`Newsletter welcome coupon created: ${couponCode} for ${email}`)

    // ── 5. Queue welcome email with coupon code ────────────────
    await this.emailService.enqueue({
      to: email,
      type: 'welcome',
      lang: locale,
      data: {
        firstName: email.split('@')[0],
        couponCode,
        discountPercent: 10,
        expiresAt: expiresAt.toLocaleDateString(locale === 'ar' ? 'ar-EG' : locale === 'en' ? 'en-GB' : 'de-DE'),
        loginUrl: 'https://malak-bekleidung.com/login',
      },
    })

    // ── 6. Return success ──────────────────────────────────────
    return {
      success: true,
      message: {
        de: 'Gutschein an deine E-Mail gesendet!',
        en: 'Coupon sent to your email!',
        ar: 'تم إرسال القسيمة إلى بريدك!',
      },
    }
  }
}
