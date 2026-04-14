import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { EmailService } from '../email/email.service'
import { NotificationService } from '../admin/services/notification.service'
import { CreateContactDto } from './dto/create-contact.dto'

/**
 * Public contact-form service.
 *
 * Handles:
 *   1. Honeypot spam check (silent accept, no DB write)
 *   2. Per-IP rate limit (3 per hour)
 *   3. Persist ContactMessage row
 *   4. Queue admin notification email + customer confirmation email
 *   5. Create admin dashboard notification (bell badge)
 */
@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly notificationService: NotificationService,
  ) {}

  async submit(dto: CreateContactDto, meta: { ipAddress?: string; userAgent?: string }) {
    const locale = (['de', 'en', 'ar'] as const).includes(dto.locale as any)
      ? (dto.locale as 'de' | 'en' | 'ar')
      : 'de'

    // ── 1. Honeypot: silently accept but do nothing ──
    // Returning "ok" keeps bots from retrying. Real users never fill this.
    if (dto.website && dto.website.trim().length > 0) {
      this.logger.warn(`Honeypot triggered from IP ${meta.ipAddress ?? 'unknown'} (${dto.email})`)
      return { ok: true }
    }

    // ── 2. Rate limit: max 3 submissions per IP per hour ──
    if (meta.ipAddress) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
      const recent = await this.prisma.contactMessage.count({
        where: { ipAddress: meta.ipAddress, createdAt: { gte: oneHourAgo } },
      })
      if (recent >= 3) {
        throw new ForbiddenException({
          statusCode: 429,
          error: 'RateLimited',
          message: {
            de: 'Zu viele Anfragen. Bitte versuche es in einer Stunde erneut.',
            en: 'Too many requests. Please try again in an hour.',
            ar: 'طلبات كثيرة جداً. يرجى المحاولة مرة أخرى خلال ساعة.',
          },
        })
      }
    }

    // Basic sanity: trimmed lengths after class-validator
    const trimmed = {
      name: dto.name.trim(),
      email: dto.email.trim().toLowerCase(),
      subject: dto.subject.trim(),
      message: dto.message.trim(),
    }
    if (!trimmed.name || !trimmed.email || !trimmed.subject || !trimmed.message) {
      throw new BadRequestException('Missing required fields')
    }

    // ── 3. Persist ──
    const row = await this.prisma.contactMessage.create({
      data: {
        name: trimmed.name,
        email: trimmed.email,
        subject: trimmed.subject,
        message: trimmed.message,
        locale,
        status: 'new',
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
      },
    })
    this.logger.log(`Contact message ${row.id} saved from ${trimmed.email}`)

    // ── 4a. Admin notification email (fire-and-forget) ──
    const adminEmail = process.env.CONTACT_ADMIN_EMAIL || 'info@malak-bekleidung.com'
    this.emailService
      .enqueue({
        to: adminEmail,
        type: 'contact-new',
        lang: 'de', // admin reads German
        data: {
          name: trimmed.name,
          email: trimmed.email,
          subject: trimmed.subject,
          message: trimmed.message,
          locale,
          createdAt: row.createdAt.toLocaleString('de-DE'),
          adminUrl: `${process.env.APP_URL ?? 'https://malak-bekleidung.com'}/de/admin/contact-messages`,
        },
      })
      .catch((e) => this.logger.error(`Admin contact email failed: ${(e as Error).message}`))

    // ── 4b. Customer auto-reply (fire-and-forget) ──
    this.emailService
      .enqueue({
        to: trimmed.email,
        type: 'contact-received',
        lang: locale,
        data: {
          name: trimmed.name,
          subject: trimmed.subject,
          appUrl: process.env.APP_URL ?? 'https://malak-bekleidung.com',
        },
      })
      .catch((e) => this.logger.error(`Customer confirmation email failed: ${(e as Error).message}`))

    // ── 5. Dashboard bell notification ──
    // Pass raw fields via `data` so the frontend's translateNotif() can
    // localize the title/body per admin locale. The top-level title/body
    // are German fallbacks only (shown if the type is unknown).
    this.notificationService
      .createForAllAdmins({
        type: 'contact_message',
        title: `Neue Nachricht: ${trimmed.subject}`,
        body: `${trimmed.name} (${trimmed.email})`,
        entityType: 'contact_message',
        entityId: row.id,
        data: {
          subject: trimmed.subject,
          name: trimmed.name,
          email: trimmed.email,
          messagePreview: trimmed.message.slice(0, 80),
        },
      })
      .catch((e) => this.logger.error(`Notification create failed: ${(e as Error).message}`))

    return { ok: true, id: row.id }
  }

  // ── Admin list ──
  async listForAdmin(params: { status?: string; limit?: number; offset?: number }) {
    const limit = Math.min(params.limit ?? 50, 200)
    const offset = params.offset ?? 0
    const where = params.status ? { status: params.status } : {}
    const [rows, total, unread] = await Promise.all([
      this.prisma.contactMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.contactMessage.count({ where }),
      this.prisma.contactMessage.count({ where: { status: 'new' } }),
    ])
    return { data: rows, meta: { total, limit, offset, unread } }
  }

  async markAsRead(id: string, adminId: string) {
    const existing = await this.prisma.contactMessage.findUnique({ where: { id } })
    if (!existing) throw new BadRequestException('Message not found')
    if (existing.status !== 'new') return existing
    return this.prisma.contactMessage.update({
      where: { id },
      data: { status: 'read', readAt: new Date(), readBy: adminId },
    })
  }

  async updateStatus(id: string, status: 'new' | 'read' | 'replied' | 'spam', adminId: string) {
    if (!['new', 'read', 'replied', 'spam'].includes(status)) {
      throw new BadRequestException('Invalid status')
    }
    const data: any = { status }
    if (status !== 'new') {
      data.readAt = new Date()
      data.readBy = adminId
    }
    return this.prisma.contactMessage.update({ where: { id }, data })
  }

  async unreadCount() {
    return this.prisma.contactMessage.count({ where: { status: 'new' } })
  }

  // Hard delete — DB space is money. Admins manage their own inbox retention.
  async deleteOne(id: string) {
    await this.prisma.contactMessage.delete({ where: { id } })
    return { ok: true }
  }

  // Bulk delete with ID array (used for multi-select in admin list).
  async deleteMany(ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('No IDs provided')
    }
    const result = await this.prisma.contactMessage.deleteMany({
      where: { id: { in: ids } },
    })
    return { ok: true, deleted: result.count }
  }

  // One-click "clean up spam + old read" — typical admin housekeeping.
  async deleteSpamAndOld(olderThanDays: number = 30) {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)
    const result = await this.prisma.contactMessage.deleteMany({
      where: {
        OR: [
          { status: 'spam' },
          { status: { in: ['read', 'replied'] }, createdAt: { lt: cutoff } },
        ],
      },
    })
    return { ok: true, deleted: result.count }
  }
}
