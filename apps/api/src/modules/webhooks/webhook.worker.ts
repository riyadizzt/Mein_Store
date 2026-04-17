import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Worker, Job } from 'bullmq'
import { PrismaService } from '../../prisma/prisma.service'
import { QUEUE_NAMES } from '../../queues/queue.constants'
import { buildDeliveryHeaders } from './webhook-signer'
import type { WebhookDeliveryJob } from './webhook-dispatcher.service'
import { WEBHOOK_MAX_ATTEMPTS, WEBHOOK_RETRY_DELAYS_MS } from './webhook-dispatcher.service'

/** HTTP request timeout per attempt. n8n docs recommend responding < 10s. */
const DELIVERY_TIMEOUT_MS = 10_000

@Injectable()
export class WebhookWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookWorker.name)
  private worker?: Worker

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    // Mirror the EmailWorker activation pattern:
    //   - production: always on
    //   - elsewhere: opt-in via WEBHOOK_WORKER_ENABLED=true
    const enabled =
      process.env.WEBHOOK_WORKER_ENABLED === 'true' || process.env.NODE_ENV === 'production'
    if (!enabled) {
      this.logger.log(
        'Webhook worker SKIPPED — set WEBHOOK_WORKER_ENABLED=true in .env to activate',
      )
      return
    }

    const url = this.config.getOrThrow<string>('UPSTASH_REDIS_REST_URL')
    const token = this.config.getOrThrow<string>('UPSTASH_REDIS_REST_TOKEN')
    const host = url.replace('https://', '')

    this.worker = new Worker(
      QUEUE_NAMES.WEBHOOK_DELIVERY,
      async (job: Job<WebhookDeliveryJob>) => {
        await this.handleDelivery(job)
      },
      {
        connection: { host, port: 6379, password: token, tls: {} },
        concurrency: 5,
        drainDelay: 30_000,
        stalledInterval: 300_000,
      },
    )

    this.worker.on('completed', (job) => {
      this.logger.log(`Webhook delivered (job ${job.id}) — log ${job.data.deliveryLogId}`)
    })

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Webhook delivery failed (job ${job?.id}, attempt ${job?.attemptsMade}/${job?.opts?.attempts}): ${err.message}`,
      )
    })

    this.logger.log(`Webhook worker started — listening on "${QUEUE_NAMES.WEBHOOK_DELIVERY}"`)
  }

  async onModuleDestroy() {
    await this.worker?.close()
  }

  /**
   * Consume one job: load delivery log → POST → update log → update sub stats.
   * Throws on non-2xx so BullMQ records the attempt and schedules retry.
   */
  private async handleDelivery(job: Job<WebhookDeliveryJob>): Promise<void> {
    const { deliveryLogId } = job.data
    const log = await this.prisma.webhookDeliveryLog.findUnique({ where: { id: deliveryLogId } })
    if (!log) {
      this.logger.warn(`Delivery log ${deliveryLogId} not found — job will not be retried`)
      return
    }
    const sub = await this.prisma.webhookSubscription.findUnique({ where: { id: log.subscriptionId } })
    if (!sub) {
      this.logger.warn(
        `Subscription ${log.subscriptionId} no longer exists — marking log as failed, no retry`,
      )
      await this.prisma.webhookDeliveryLog.update({
        where: { id: log.id },
        data: {
          status: 'failed',
          errorMessage: 'Subscription was deleted before delivery completed',
          completedAt: new Date(),
        },
      })
      return
    }
    if (!sub.isActive) {
      this.logger.log(`Subscription ${sub.id} is inactive — skipping delivery ${log.id}`)
      await this.prisma.webhookDeliveryLog.update({
        where: { id: log.id },
        data: {
          status: 'failed',
          errorMessage: 'Subscription was deactivated before delivery completed',
          completedAt: new Date(),
        },
      })
      return
    }

    // Build the raw body + headers. rawBody must be byte-identical to what
    // we send on the wire so n8n's signature verification matches.
    const rawBody = JSON.stringify(log.payload)
    const headers = buildDeliveryHeaders({
      secret: sub.secret,
      eventId: log.eventId,
      eventType: log.eventType,
      rawBody,
    })

    const attemptNumber = log.attemptCount + 1
    const attemptedAt = new Date()

    let httpStatus: number | null = null
    let responseBody: string | null = null
    let errorMessage: string | null = null
    let success = false

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS)
      try {
        const res = await fetch(sub.url, {
          method: 'POST',
          headers,
          body: rawBody,
          signal: controller.signal,
        })
        httpStatus = res.status
        // Read up to ~10 KB of response — more than that is always garbage/HTML.
        const text = await res.text().catch(() => '')
        responseBody = text.slice(0, 10_000)
        success = res.ok
        if (!success) {
          errorMessage = `HTTP ${res.status} ${res.statusText}`
        }
      } finally {
        clearTimeout(timer)
      }
    } catch (err: any) {
      errorMessage = err?.name === 'AbortError'
        ? `Timeout after ${DELIVERY_TIMEOUT_MS}ms`
        : err?.message ?? String(err)
    }

    const isFinalAttempt = attemptNumber >= WEBHOOK_MAX_ATTEMPTS

    await this.prisma.webhookDeliveryLog.update({
      where: { id: log.id },
      data: {
        status: success ? 'success' : isFinalAttempt ? 'failed' : 'pending',
        httpStatus,
        responseBody,
        errorMessage,
        attemptCount: attemptNumber,
        lastAttemptAt: attemptedAt,
        completedAt: success || isFinalAttempt ? attemptedAt : null,
        nextAttemptAt:
          !success && !isFinalAttempt
            ? new Date(attemptedAt.getTime() + (WEBHOOK_RETRY_DELAYS_MS[attemptNumber - 1] ?? 0))
            : null,
      },
    })

    // Update subscription-level stats. Best-effort — any DB error here must
    // not prevent the job from being retried.
    try {
      const subUpdate: any = {
        totalDeliveries: { increment: 1 },
        lastDeliveryAt: attemptedAt,
      }
      if (success) {
        subUpdate.totalSuccesses = { increment: 1 }
        subUpdate.consecutiveFailures = 0
        subUpdate.lastSuccessAt = attemptedAt
      } else if (isFinalAttempt) {
        subUpdate.totalFailures = { increment: 1 }
        subUpdate.consecutiveFailures = { increment: 1 }
        subUpdate.lastFailureAt = attemptedAt
      }
      await this.prisma.webhookSubscription.update({
        where: { id: sub.id },
        data: subUpdate,
      })
    } catch (e: any) {
      this.logger.warn(`Stats update for sub ${sub.id} failed: ${e.message}`)
    }

    if (!success) {
      // Throw so BullMQ records the attempt and retries using the job's
      // backoff config. The producer already set attempts=3 with custom delays.
      const err = new Error(errorMessage ?? 'delivery failed')
      ;(err as any).httpStatus = httpStatus
      throw err
    }
  }
}
