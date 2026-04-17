/**
 * Sentry initialization — MUST be imported before everything else in main.ts
 * so that Sentry's auto-instrumentation hooks can wrap all subsequent imports
 * (DB drivers, HTTP clients, NestJS internals).
 *
 * Graceful degradation: if SENTRY_DSN is not set, this file is a no-op.
 * The SDK is never initialized, no telemetry is collected, no network calls
 * are made. The system behaves EXACTLY as it does today.
 */
import * as Sentry from '@sentry/nestjs'

const dsn = process.env.SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,

    // 100% of errors are captured. Performance traces default to 10% to
    // stay under the Free-tier quota; can be raised via env if needed.
    tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
      ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
      : 0.1,

    // Per project requirement — don't pollute Sentry with expected client
    // errors. These are NORMAL behavior, not bugs:
    //   400 — validation rejections from the frontend (class-validator)
    //   401 — unauthorized (login failures, expired tokens)
    //   404 — not found (missing pages, deleted resources)
    //   429 — rate-limited (ThrottlerException)
    // Plus: AccountBlocked is a structured ForbiddenException we throw in
    // auth.service — expected business logic, not a crash.
    beforeSend(event, hint) {
      const IGNORED_STATUSES = new Set([400, 401, 404, 429])

      const status = (event.contexts?.response as any)?.status_code
      if (typeof status === 'number' && IGNORED_STATUSES.has(status)) return null

      const error = hint.originalException as any
      if (typeof error?.status === 'number' && IGNORED_STATUSES.has(error.status)) {
        return null
      }

      // NestJS HttpException's response shape: either a plain string or
      // an object like { statusCode, error, message }. We throw
      //   throw new ForbiddenException({ error: 'AccountBlocked', ... })
      // in auth.service.ts — that's expected, not a bug worth reporting.
      const response = error?.response
      if (response && typeof response === 'object' && response.error === 'AccountBlocked') {
        return null
      }

      return event
    },

    // Strip sensitive query params from URLs AND drop high-volume noise
    // transactions (health checks) from the performance trace stream.
    beforeSendTransaction(event) {
      // Drop /api/v1/health — UptimeRobot/Kubernetes-probe spam would
      // otherwise drown out real slow-endpoint signals.
      const txName = event.transaction ?? ''
      const txUrl = event.request?.url ?? ''
      if (txName.includes('/health') || txUrl.includes('/api/v1/health')) {
        return null
      }

      // Belt-and-suspenders: redact tokens that somehow landed in a URL.
      if (event.request?.url) {
        event.request.url = event.request.url.replace(
          /[?&](token|password|jwt|secret)=[^&]*/g,
          (_, k) => `?${k}=[REDACTED]`,
        )
      }
      return event
    },

    serverName: process.env.HOSTNAME ?? undefined,
  })

  // eslint-disable-next-line no-console
  console.log(
    `[Sentry] Initialized — environment=${process.env.NODE_ENV ?? 'development'}`,
  )
}
// Else: completely silent. No init, no warnings, no telemetry.
