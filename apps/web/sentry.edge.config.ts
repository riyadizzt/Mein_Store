/**
 * Sentry — EDGE runtime config.
 *
 * Runs in Next.js Edge Runtime (Cloudflare Workers-like V8 isolates):
 *   - apps/web/src/middleware.ts (next-intl locale routing)
 *   - any route with `export const runtime = 'edge'`
 *
 * Edge runtime has no Node.js APIs (no fs, no net, no process.hrtime),
 * so Sentry here is lighter than server/client. We keep the config minimal.
 *
 * Graceful degradation: same pattern as client+server — if no DSN, no init.
 */
import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? process.env.SENTRY_RELEASE,

    // Edge handles very light workloads (locale routing). Lower trace rate.
    tracesSampleRate: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
      ? Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE)
      : 0.05,

    beforeSend(event, hint) {
      const IGNORED_STATUSES = new Set([400, 401, 404, 429])
      const status = (event.contexts?.response as any)?.status_code
      if (typeof status === 'number' && IGNORED_STATUSES.has(status)) return null
      const error = hint.originalException as any
      if (typeof error?.status === 'number' && IGNORED_STATUSES.has(error.status)) return null
      return event
    },
  })
}
