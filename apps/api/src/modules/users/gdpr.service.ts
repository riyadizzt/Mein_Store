import { Injectable, Logger, BadRequestException, Optional } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { Inject } from '@nestjs/common'
import { Queue } from 'bullmq'
import * as bcrypt from 'bcrypt'
import { PrismaService } from '../../prisma/prisma.service'
import { InvalidPasswordException } from './exceptions/invalid-password.exception'
import { UserNotFoundException } from './exceptions/user-not-found.exception'
import { NotificationService } from '../admin/services/notification.service'
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service'

const ANONYMIZATION_DELAY_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

@Injectable()
export class GdprService {
  private readonly logger = new Logger(GdprService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject('GDPR_QUEUE') private readonly gdprQueue: Queue,
    // Optional: present in runtime (admin module exports it), absent in
    // unit tests that only provide Prisma + queue. Null-safe call below.
    @Optional() private readonly notificationService?: NotificationService,
    // Same optional pattern for webhook dispatch — test-friendly.
    @Optional() private readonly webhookDispatcher?: WebhookDispatcherService,
  ) {}

  // ── Data Export (Art. 20 DSGVO) ─────────────────────────────

  async requestDataExport(userId: string): Promise<{ requestId: string }> {
    // Only 1 active request at a time
    const existing = await this.prisma.dataExportRequest.findFirst({
      where: { userId, status: { in: ['pending', 'processing'] } },
    })
    if (existing) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'ExportAlreadyPending',
        message: {
          de: 'Es läuft bereits eine Datenexport-Anfrage. Bitte warten.',
          en: 'A data export request is already pending. Please wait.',
          ar: 'يوجد طلب تصدير بيانات قيد الانتظار. يرجى الانتظار.',
        },
      })
    }

    const request = await this.prisma.dataExportRequest.create({
      data: { userId, status: 'pending' },
    })

    // Enqueue export job
    await this.gdprQueue.add('data-export', { userId, requestId: request.id })

    return { requestId: request.id }
  }

  async buildDataExport(userId: string): Promise<Record<string, unknown>> {
    const [user, addresses, orders, consents, reviews, wishlist] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          preferredLang: true,
          createdAt: true,
          lastLoginAt: true,
        },
      }),
      this.prisma.address.findMany({
        where: { userId, deletedAt: null },
      }),
      this.prisma.order.findMany({
        where: { userId, deletedAt: null },
        include: { items: true, payment: { select: { method: true, status: true } } },
      }),
      this.prisma.gdprConsent.findMany({ where: { userId } }),
      this.prisma.productReview.findMany({
        where: { userId, deletedAt: null },
        select: { rating: true, title: true, body: true, createdAt: true },
      }),
      this.prisma.wishlistItem.findMany({ where: { userId } }),
    ])

    return {
      exportedAt: new Date().toISOString(),
      user,
      addresses,
      orders,
      consents,
      reviews,
      wishlist,
    }
  }

  // ── Consent Management ───────────────────────────────────────

  async getConsents(userId: string) {
    return this.prisma.gdprConsent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async updateConsent(
    userId: string,
    consentType: string,
    isGranted: boolean,
    ipAddress: string,
    userAgent: string,
    source: string,
  ) {
    return this.prisma.gdprConsent.create({
      data: {
        userId,
        consentType: consentType as any,
        isGranted,
        grantedAt: isGranted ? new Date() : null,
        withdrawnAt: !isGranted ? new Date() : null,
        consentVersion: '1.0',
        ipAddress,
        userAgent,
        source: source as any,
      },
    })
  }

  // ── Account Deletion (30-day window) ─────────────────────────

  async scheduleAccountDeletion(userId: string, password: string): Promise<{ scheduledAt: Date }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, anonymizedAt: null },
      select: { passwordHash: true, scheduledDeletionAt: true, email: true },
    })
    if (!user) throw new UserNotFoundException(userId)

    if (user.scheduledDeletionAt) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'DeletionAlreadyScheduled',
        message: {
          de: `Kontolöschung ist bereits für ${user.scheduledDeletionAt.toISOString()} geplant.`,
          en: `Account deletion is already scheduled for ${user.scheduledDeletionAt.toISOString()}.`,
          ar: `حذف الحساب مجدول بالفعل في ${user.scheduledDeletionAt.toISOString()}.`,
        },
      })
    }

    if (!user.passwordHash) throw new InvalidPasswordException()
    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) throw new InvalidPasswordException()

    const scheduledAt = new Date(Date.now() + ANONYMIZATION_DELAY_MS)

    await this.prisma.user.update({
      where: { id: userId },
      data: { scheduledDeletionAt: scheduledAt, isActive: false },
    })

    // Enqueue BullMQ delayed job (primary mechanism)
    await this.gdprQueue.add(
      'anonymize-user',
      { userId },
      { delay: ANONYMIZATION_DELAY_MS, jobId: `anonymize-${userId}` },
    )

    this.logger.log(`Account deletion scheduled for user ${userId} at ${scheduledAt.toISOString()}`)

    // Fire-and-forget bell notification for admins. Wrapped in a check
    // because the service is optional in tests. Any failure here must
    // never break the user-facing deletion flow.
    this.notificationService
      ?.createForAllAdmins({
        type: 'account_deletion_requested',
        title: 'Kontolöschung beantragt',
        body: 'Ein Kunde hat die Löschung seines Kontos beantragt',
        entityType: 'user',
        entityId: userId,
        data: { userId, scheduledAt: scheduledAt.toISOString() },
      })
      .catch((err) => this.logger.error(`Deletion notification failed: ${(err as Error).message}`))

    // Fire-and-forget outbound webhook — never awaited, never throws.
    this.webhookDispatcher
      ?.emit('customer.deletion_requested', {
        userId,
        email: user.email,
        scheduledDeletionAt: scheduledAt.toISOString(),
        requestedAt: new Date().toISOString(),
      })
      .catch((err) => this.logger.warn(`customer.deletion_requested webhook failed: ${err?.message ?? err}`))

    return { scheduledAt }
  }

  async cancelAccountDeletion(userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, scheduledDeletionAt: { not: null } },
    })
    if (!user) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'NoDeletionScheduled',
        message: {
          de: 'Keine geplante Kontolöschung gefunden.',
          en: 'No scheduled account deletion found.',
          ar: 'لا يوجد حذف حساب مجدول.',
        },
      })
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { scheduledDeletionAt: null, isActive: true },
    })

    // Remove BullMQ job if still waiting
    const job = await this.gdprQueue.getJob(`anonymize-${userId}`)
    if (job) {
      const state = await job.getState()
      if (state === 'delayed' || state === 'waiting') {
        await job.remove()
      }
    }

    this.logger.log(`Account deletion cancelled for user ${userId}`)
  }

  async anonymizeUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, anonymizedAt: null },
    })
    if (!user) {
      this.logger.warn(`Anonymization skipped — user ${userId} not found or already anonymized`)
      return
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          email: `anonymized-${userId}@deleted.malak-bekleidung.com`,
          firstName: 'Gelöscht',
          lastName: 'Nutzer',
          phone: null,
          passwordHash: null,
          profileImageUrl: null,
          anonymizedAt: new Date(),
          isActive: false,
          scheduledDeletionAt: null,
        },
      }),
      this.prisma.address.updateMany({
        where: { userId },
        data: { deletedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId },
        data: { isRevoked: true },
      }),
    ])

    this.logger.log(`User ${userId} anonymized (GDPR Art. 17)`)
  }

  // ── Daily Cron safety net ────────────────────────────────────
  // Catches any users where the BullMQ job was missed (e.g. Redis restart)

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async anonymizeOverdueUsers(): Promise<void> {
    const overdueUsers = await this.prisma.user.findMany({
      where: {
        scheduledDeletionAt: { lte: new Date() },
        anonymizedAt: null,
        deletedAt: null,
      },
      select: { id: true },
    })

    if (overdueUsers.length === 0) return

    this.logger.log(`Cron: anonymizing ${overdueUsers.length} overdue user(s)`)

    for (const { id } of overdueUsers) {
      try {
        await this.anonymizeUser(id)
      } catch (err) {
        this.logger.error(`Cron anonymization failed for user ${id}`, err)
      }
    }
  }
}
