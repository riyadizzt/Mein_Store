import { Injectable, Logger, Inject, Optional } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { WebhookService } from './webhook.service'
import {
  WEBHOOK_API_VERSION,
  type WebhookEnvelope,
  type WebhookEventPayloads,
  type WebhookEventType,
  isValidEventType,
} from './events'
import { JOB_NAMES } from '../../queues/queue.constants'

/**
 * Job payload the worker consumes. The worker (webhook.worker.ts)
 * re-loads the DeliveryLog row to get the full body on each attempt —
 * this keeps the queue payload tiny even for large events.
 */
export interface WebhookDeliveryJob {
  deliveryLogId: string
}

/**
 * Retry policy — 3 attempts with exponential backoff:
 *   attempt 1 → immediate
 *   attempt 2 → 30 s  after failure
 *   attempt 3 → 5 min after the previous failure
 *   attempt 4 → 30 min after the previous failure
 *
 * BullMQ computes delay as `delay * 2^(attempts-1)` when type='exponential'.
 * With delay=30_000 and attempts=3, the retries fall at ~30s, ~60s, ~120s.
 * We want 30s / 5min / 30min specifically — so we go fixed with manual scale.
 */
export const WEBHOOK_MAX_ATTEMPTS = 3
export const WEBHOOK_RETRY_DELAYS_MS = [30_000, 5 * 60_000, 30 * 60_000] as const

@Injectable()
export class WebhookDispatcherService {
  private readonly logger = new Logger(WebhookDispatcherService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: WebhookService,
    // The queue is @Global via QueueModule. Optional() so unit tests can
    // construct the service without wiring a queue provider.
    @Optional() @Inject('WEBHOOK_DELIVERY_QUEUE') private readonly queue?: any,
  ) {}

  /**
   * Fire-and-forget emit. Never throws to the caller — all errors are
   * logged and swallowed. Safe to call inline from any business service
   * without fear of crashing the request path.
   *
   * Do NOT await this unless you specifically want to know how many
   * deliveries were enqueued (useful only for tests).
   */
  async emit<T extends WebhookEventType>(
    eventType: T,
    object: WebhookEventPayloads[T],
  ): Promise<{ enqueued: number; errors: string[] }> {
    if (!isValidEventType(eventType)) {
      this.logger.warn(`emit() called with unknown event type: ${eventType}`)
      return { enqueued: 0, errors: [`unknown event type: ${eventType}`] }
    }
    const errors: string[] = []
    let enqueued = 0

    try {
      const subs = await this.subscriptions.findActiveForEvent(eventType)
      if (subs.length === 0) return { enqueued: 0, errors: [] }

      for (const sub of subs) {
        try {
          const envelope: WebhookEnvelope = {
            id: randomUUID(),
            type: eventType,
            created: new Date().toISOString(),
            apiVersion: WEBHOOK_API_VERSION,
            data: { object },
          }

          // Create the delivery log first so the admin sees it queued.
          // Unique on (subscription_id, event_id) — envelope.id is fresh so no collision.
          const log = await this.prisma.webhookDeliveryLog.create({
            data: {
              subscriptionId: sub.id,
              eventType,
              eventId: envelope.id,
              payload: envelope as any,
              status: 'pending',
              attemptCount: 0,
            },
          })

          // Enqueue BullMQ job. In dev the queue is NoOp — log stays pending,
          // no delivery happens. In production, the worker picks it up.
          if (this.queue) {
            await this.queue.add(
              JOB_NAMES.DELIVER_WEBHOOK,
              { deliveryLogId: log.id } as WebhookDeliveryJob,
              {
                attempts: WEBHOOK_MAX_ATTEMPTS,
                removeOnComplete: { age: 24 * 3600, count: 1000 },
                removeOnFail: { age: 7 * 24 * 3600 },
              },
            )
          }
          enqueued++
        } catch (err: any) {
          const msg = `subscription ${sub.id}: ${err?.message ?? String(err)}`
          errors.push(msg)
          this.logger.error(`Webhook emit failed for ${eventType} — ${msg}`)
        }
      }
    } catch (err: any) {
      // Top-level catch: look-up failed, can't find subscriptions. Swallow
      // so the caller (order service, etc.) never crashes on webhook failure.
      const msg = `findActiveForEvent failed: ${err?.message ?? String(err)}`
      errors.push(msg)
      this.logger.error(`Webhook emit top-level error for ${eventType} — ${msg}`)
    }

    return { enqueued, errors }
  }

  /**
   * Admin action: manually re-send a previously-failed delivery.
   * Resets attempt counter and enqueues a fresh job. Returns the updated log.
   */
  async retryDelivery(deliveryLogId: string) {
    const log = await this.subscriptions.getDeliveryLog(deliveryLogId)
    const updated = await this.prisma.webhookDeliveryLog.update({
      where: { id: deliveryLogId },
      data: {
        status: 'pending',
        errorMessage: null,
        httpStatus: null,
        responseBody: null,
        nextAttemptAt: null,
        // attemptCount is NOT reset — we keep the full history. Worker
        // respects the cap WEBHOOK_MAX_ATTEMPTS based on this counter.
      },
    })
    if (this.queue) {
      await this.queue.add(
        JOB_NAMES.DELIVER_WEBHOOK,
        { deliveryLogId: log.id } as WebhookDeliveryJob,
        {
          attempts: 1, // single attempt on manual retry — admin is watching
          removeOnComplete: { age: 24 * 3600, count: 1000 },
          removeOnFail: { age: 7 * 24 * 3600 },
        },
      )
    }
    return updated
  }

  /**
   * Admin action: test a subscription by sending a synthetic event.
   * Bypasses the normal event flow and fires ONE synthetic delivery.
   * Used by the "Send test event" button in the admin UI.
   */
  async sendTestEvent(subscriptionId: string) {
    const sub = await this.subscriptions.findOne(subscriptionId)
    const envelope: WebhookEnvelope<{ test: boolean; message: string }> = {
      id: randomUUID(),
      type: 'order.created' as WebhookEventType, // placeholder — test events use first whitelisted type
      created: new Date().toISOString(),
      apiVersion: WEBHOOK_API_VERSION,
      data: {
        object: {
          test: true,
          message: 'This is a test event from Malak Bekleidung admin panel.',
        },
      },
    }
    const log = await this.prisma.webhookDeliveryLog.create({
      data: {
        subscriptionId: sub.id,
        eventType: envelope.type,
        eventId: envelope.id,
        payload: envelope as any,
        status: 'pending',
        attemptCount: 0,
      },
    })
    if (this.queue) {
      await this.queue.add(
        JOB_NAMES.DELIVER_WEBHOOK,
        { deliveryLogId: log.id } as WebhookDeliveryJob,
        { attempts: 1 },
      )
    }
    return log
  }
}
