/**
 * Sentry — SERVER config (Node.js runtime).
 *
 * Runs in Next.js server-side contexts:
 *   - Server Components / layouts (initial HTML render)
 *   - Route Handlers under app/api/**
 *   - getServerSideProps / getStaticProps in legacy Pages API
 *
 * Graceful degradation: if SENTRY_DSN is not set (server can use the
 * non-NEXT_PUBLIC variant; we also accept NEXT_PUBLIC_SENTRY_DSN as a
 * fallback for convenience), Sentry.init() is skipped entirely.
 */
import * as Sentry from '@sentry/nextjs'

// Server-side can use either the plain SENTRY_DSN (not bundled to client)
// or fall back to the public one the client uses. Both work; we try both.
const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? process.env.SENTRY_RELEASE,

    tracesSampleRate: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
      ? Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE)
      : 0.1,

    beforeSend(event, hint) {
      const IGNORED_STATUSES = new Set([400, 401, 404, 429])
      const status = (event.contexts?.response as any)?.status_code
      if (typeof status === 'number' && IGNORED_STATUSES.has(status)) return null
      const error = hint.originalException as any
      if (typeof error?.status === 'number' && IGNORED_STATUSES.has(error.status)) return null
      return event
    },

    // Strip sensitive query-string params from URLs in traces.
    beforeSendTransaction(event) {
      if (event.request?.url) {
        event.request.url = event.request.url.replace(
          /[?&](token|password|jwt|secret)=[^&]*/g,
          (_, k) => `?${k}=[REDACTED]`,
        )
      }
      return event
    },
  })
}
// Else: silent.
