/**
 * SafeCron — drop-in replacement for @nestjs/schedule's @Cron decorator
 * that emits an alert event when the wrapped method throws.
 *
 * Why this exists:
 *   The default @Cron behaviour for an uncaught exception is:
 *     1. NestJS scheduler logs the error at ERROR level
 *     2. The next scheduled tick proceeds normally
 *   No admin notification is created — the crash is invisible unless
 *   somebody is reading the server logs in real time.
 *
 * SafeCron preserves all of the above (the underlying @Cron is still
 * applied, the error is still re-thrown so NestJS still logs) and ADDS:
 *     - on catch: emit `cron.crashed` on a process-local Node EventEmitter
 *     - listener (registered separately) translates that into an admin
 *       notification of type 'cron_crashed'
 *
 * The Node EventEmitter is process-local (not the NestJS EventEmitter2)
 * so the decorator stays framework-free and has zero DI requirements.
 *
 * Usage — exact drop-in replacement:
 *     @SafeCron('* /5 * * * *')
 *     async cleanupTimedOutOrders() { ... }
 *
 *     @SafeCron(CronExpression.EVERY_HOUR, { name: 'vorkasse-cron' })
 *     async checkBankTransfers() { ... }
 */
import { EventEmitter } from 'node:events'
import { Cron, type CronOptions } from '@nestjs/schedule'

// Mirror @Cron's first-parameter type without taking a hard dep on `cron`.
// Parameters<typeof Cron>[0] resolves to whatever the installed @nestjs/
// schedule version expects (currently cron's CronJobParams['cronTime']).
type CronTime = Parameters<typeof Cron>[0]

/** Process-local event bus for cron crashes. NOT NestJS EventEmitter2. */
export const cronEvents = new EventEmitter()
// Don't blow up the process if 11+ crons are listening (we have 9 right now).
cronEvents.setMaxListeners(50)

export interface CronCrashEvent {
  cronClass: string
  method: string
  cronExpression: string
  error: Error
  occurredAt: Date
}

/**
 * Marker symbol attached to wrapped methods so we can detect them in tests
 * and avoid double-wrapping by accident.
 */
export const SAFE_CRON_WRAPPED = Symbol.for('malak.safe-cron.wrapped')

/**
 * Drop-in replacement for @Cron that wraps the method in a try/catch and
 * emits `cron.crashed` on cronEvents before re-throwing the error.
 *
 * The error is re-thrown so the NestJS scheduler still logs it at ERROR
 * level — the alert is purely additive, never replaces existing logging.
 */
export function SafeCron(
  cronTime: CronTime,
  options?: CronOptions,
): MethodDecorator {
  return function safeCronDecorator(
    target: any,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): void {
    const original = descriptor.value
    if (typeof original !== 'function') {
      // Defensive: if @SafeCron is misapplied to a non-method, fall through
      // and let @Cron raise its own error.
      Cron(cronTime, options)(target, propertyKey, descriptor)
      return
    }
    if ((original as any)[SAFE_CRON_WRAPPED]) {
      // Already wrapped — re-applying SafeCron would nest catches.
      // Just delegate to @Cron with the original function.
      Cron(cronTime, options)(target, propertyKey, descriptor)
      return
    }

    const className = target?.constructor?.name ?? 'UnknownCron'
    const methodName = String(propertyKey)
    const cronExpressionStr =
      typeof cronTime === 'string' ? cronTime : '<custom>'

    async function safeCronWrapper(this: any, ...args: any[]) {
      try {
        return await original.apply(this, args)
      } catch (err: any) {
        // Build the alert event payload. Defensive — if any field cannot
        // be derived, fall back to a string so the listener always gets
        // something to render.
        const event: CronCrashEvent = {
          cronClass: className,
          method: methodName,
          cronExpression: cronExpressionStr,
          error: err instanceof Error ? err : new Error(String(err)),
          occurredAt: new Date(),
        }
        // emit() is synchronous and listeners run on the same tick. If a
        // listener throws, the EventEmitter would propagate it back here
        // and corrupt the scheduler's view of the error. Wrap defensively.
        try {
          cronEvents.emit('cron.crashed', event)
        } catch {
          // Listener crashed too — eat. The original error is still
          // re-thrown below, so the NestJS scheduler will still log.
        }
        throw err
      }
    }

    ;(safeCronWrapper as any)[SAFE_CRON_WRAPPED] = true
    descriptor.value = safeCronWrapper

    // Apply the underlying @Cron with the wrapped method in place.
    Cron(cronTime, options)(target, propertyKey, descriptor)
  }
}
