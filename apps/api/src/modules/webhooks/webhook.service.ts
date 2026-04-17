import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { WEBHOOK_EVENT_TYPES, isValidEventType } from './events'
import { generateWebhookSecret } from './webhook-signer'

export interface CreateSubscriptionInput {
  url: string
  events: string[]
  description?: string | null
  isActive?: boolean
  createdBy?: string | null
}

export interface UpdateSubscriptionInput {
  url?: string
  events?: string[]
  description?: string | null
  isActive?: boolean
}

function validateUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new BadRequestException({
      error: 'InvalidWebhookUrl',
      message: { de: 'Ungültige Webhook-URL', en: 'Invalid webhook URL', ar: 'عنوان الويب هوك غير صالح' },
    })
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new BadRequestException({
      error: 'InvalidWebhookUrl',
      message: {
        de: 'Webhook-URL muss http:// oder https:// sein',
        en: 'Webhook URL must use http:// or https://',
        ar: 'يجب أن يستخدم عنوان الويب هوك http:// أو https://',
      },
    })
  }
  // SSRF guard: block obvious internal targets in production. Allow localhost in dev/test.
  if (process.env.NODE_ENV === 'production') {
    const host = parsed.hostname.toLowerCase()
    const blocked =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.internal') ||
      host.endsWith('.local') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    if (blocked) {
      throw new BadRequestException({
        error: 'InternalUrlBlocked',
        message: {
          de: 'Interne / private URLs sind nicht erlaubt',
          en: 'Internal / private URLs are not allowed',
          ar: 'عناوين URL الداخلية / الخاصة غير مسموحة',
        },
      })
    }
  }
}

function validateEvents(events: string[]): void {
  if (!Array.isArray(events)) {
    throw new BadRequestException({ error: 'InvalidEvents', message: { de: 'events muss ein Array sein', en: 'events must be an array', ar: 'يجب أن يكون events مصفوفة' } })
  }
  if (events.length === 0) {
    throw new BadRequestException({
      error: 'NoEventsSelected',
      message: {
        de: 'Mindestens ein Event muss ausgewählt sein',
        en: 'At least one event must be selected',
        ar: 'يجب اختيار حدث واحد على الأقل',
      },
    })
  }
  const unknown = events.filter((e) => !isValidEventType(e))
  if (unknown.length > 0) {
    throw new BadRequestException({
      error: 'UnknownEventTypes',
      message: {
        de: `Unbekannte Event-Typen: ${unknown.join(', ')}`,
        en: `Unknown event types: ${unknown.join(', ')}`,
        ar: `أنواع الأحداث غير معروفة: ${unknown.join(', ')}`,
      },
    })
  }
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name)

  constructor(private readonly prisma: PrismaService) {}

  getAvailableEvents(): readonly string[] {
    return WEBHOOK_EVENT_TYPES
  }

  async list(params: { isActive?: boolean } = {}) {
    const where: any = {}
    if (params.isActive !== undefined) where.isActive = params.isActive
    return this.prisma.webhookSubscription.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })
  }

  async findOne(id: string) {
    const row = await this.prisma.webhookSubscription.findUnique({ where: { id } })
    if (!row) {
      throw new NotFoundException({
        error: 'SubscriptionNotFound',
        message: { de: 'Webhook-Abo nicht gefunden', en: 'Webhook subscription not found', ar: 'اشتراك الويب هوك غير موجود' },
      })
    }
    return row
  }

  async create(input: CreateSubscriptionInput) {
    validateUrl(input.url)
    validateEvents(input.events)
    const secret = generateWebhookSecret()
    const row = await this.prisma.webhookSubscription.create({
      data: {
        url: input.url,
        secret,
        events: input.events,
        description: input.description ?? null,
        isActive: input.isActive ?? true,
        createdBy: input.createdBy ?? null,
      },
    })
    this.logger.log(`Created webhook subscription ${row.id} with ${row.events.length} events`)
    return row
  }

  async update(id: string, input: UpdateSubscriptionInput) {
    await this.findOne(id)
    if (input.url !== undefined) validateUrl(input.url)
    if (input.events !== undefined) validateEvents(input.events)
    return this.prisma.webhookSubscription.update({
      where: { id },
      data: {
        ...(input.url !== undefined && { url: input.url }),
        ...(input.events !== undefined && { events: input.events }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
    })
  }

  async rotateSecret(id: string) {
    await this.findOne(id)
    const secret = generateWebhookSecret()
    return this.prisma.webhookSubscription.update({
      where: { id },
      data: { secret },
    })
  }

  async remove(id: string) {
    await this.findOne(id)
    await this.prisma.webhookSubscription.delete({ where: { id } })
    // Keep delivery logs for audit — they have subscriptionId as plain string, no FK.
    return { deleted: true }
  }

  /**
   * Find all active subscriptions that want this specific event type.
   * Used by the dispatcher on every emit.
   */
  async findActiveForEvent(eventType: string) {
    if (!isValidEventType(eventType)) return []
    return this.prisma.webhookSubscription.findMany({
      where: {
        isActive: true,
        events: { has: eventType },
      },
    })
  }

  // ── Delivery-log queries (read-only for admin) ─────────────

  async listDeliveryLogs(params: {
    subscriptionId?: string
    status?: 'pending' | 'success' | 'failed'
    eventType?: string
    limit?: number
    offset?: number
  }) {
    const where: any = {}
    if (params.subscriptionId) where.subscriptionId = params.subscriptionId
    if (params.status) where.status = params.status
    if (params.eventType) where.eventType = params.eventType
    const [rows, total] = await Promise.all([
      this.prisma.webhookDeliveryLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(params.limit ?? 50, 200),
        skip: params.offset ?? 0,
      }),
      this.prisma.webhookDeliveryLog.count({ where }),
    ])
    return { rows, total }
  }

  async getDeliveryLog(id: string) {
    const row = await this.prisma.webhookDeliveryLog.findUnique({ where: { id } })
    if (!row) {
      throw new NotFoundException({
        error: 'DeliveryLogNotFound',
        message: { de: 'Delivery-Log nicht gefunden', en: 'Delivery log not found', ar: 'سجل التسليم غير موجود' },
      })
    }
    return row
  }
}
