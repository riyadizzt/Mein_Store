/**
 * CronCrashAlertService — turns cron crashes into admin notifications.
 *
 * Hooks into the process-local `cronEvents` emitter (see safe-cron.decorator.ts)
 * exactly once at module bootstrap and creates a `cron_crashed` notification
 * for every crash. Admin gets a bell entry plus an email (via the standard
 * createForAllAdmins() pipeline).
 *
 * Fail-safe by design:
 *   - The listener wraps notifications.createForAllAdmins in try/catch. If
 *     the notification service or DB is down, the crash is just logged —
 *     the error from the cron is still logged separately by NestJS.
 *   - On module destroy the listener is detached so test runs that bootstrap
 *     the app multiple times don't accumulate listeners.
 */
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { NotificationService } from './notification.service'
import { cronEvents, type CronCrashEvent } from '../../../common/decorators/safe-cron.decorator'

@Injectable()
export class CronCrashAlertService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CronCrashAlertService.name)
  private listener?: (event: CronCrashEvent) => void

  constructor(private readonly notifications: NotificationService) {}

  onModuleInit(): void {
    this.listener = (event) => {
      // Fire-and-forget: never await, never let a notification failure
      // bubble back into the EventEmitter chain.
      this.handle(event).catch((err) =>
        this.logger.error(
          `cron-crash listener failed for ${event.cronClass}.${event.method}: ${
            err?.message ?? err
          }`,
        ),
      )
    }
    cronEvents.on('cron.crashed', this.listener)
    this.logger.log('CronCrashAlertService listening for cron.crashed events')
  }

  onModuleDestroy(): void {
    if (this.listener) {
      cronEvents.off('cron.crashed', this.listener)
      this.listener = undefined
    }
  }

  private async handle(event: CronCrashEvent): Promise<void> {
    const { cronClass, method, error, occurredAt, cronExpression } = event
    const errorMessage = error?.message ?? String(error)
    // Keep stack to the first 8 lines — full stacks are noise in the bell UI
    // and the admin can grep server logs for the full trace if needed.
    const stackSnippet = error?.stack
      ? error.stack.split('\n').slice(0, 8).join('\n')
      : null

    this.logger.error(
      `🚨 Cron crash detected: ${cronClass}.${method} — ${errorMessage}`,
    )

    try {
      await this.notifications.createForAllAdmins({
        type: 'cron_crashed',
        title: `Cron-Job abgestürzt: ${cronClass}.${method}`,
        body: errorMessage,
        entityType: 'cron',
        entityId: `${cronClass}.${method}`,
        // data payload is what the admin bell + frontend translate functions
        // consume to render the notification in the viewing admin's locale.
        data: {
          cronClass,
          method,
          cronExpression,
          errorMessage,
          errorName: error?.name ?? 'Error',
          stackSnippet,
          occurredAt: occurredAt.toISOString(),
        },
      })
    } catch (err: any) {
      // Fail-safe: notification service crashed, DB down, etc. We log only —
      // the original cron error is still surfacing via NestJS scheduler logs.
      this.logger.error(
        `Could not create cron_crashed notification (fail-safe — original error still in scheduler logs): ${
          err?.message ?? err
        }`,
      )
    }
  }
}
