/**
 * Sentry — BROWSER config.
 *
 * Runs in the user's browser on every page. Captures client-side JavaScript
 * exceptions, unhandled promise rejections, and React render errors.
 *
 * Graceful degradation: if NEXT_PUBLIC_SENTRY_DSN is not set at build time,
 * Sentry.init() is skipped and the SDK never activates. The shop runs
 * EXACTLY as it does today — no telemetry, no network calls.
 */
import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,

    // 100% of errors. Performance + session replay default to 10% to stay
    // under Free-tier quota. Adjust via env if Sentry plan upgrades.
    tracesSampleRate: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
      ? Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE)
      : 0.1,

    // Session replay: records user-clicks on error. Super valuable for
    // debugging but also privacy-sensitive. Leave OFF by default; enable
    // post-launch once we've added PII masking rules.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    // Drop expected client-side noise. These are NOT bugs:
    //   - 401/404: matches backend filter (login fails, missing pages)
    //   - ResizeObserver: harmless browser-internal race that spams Sentry
    //   - "Non-Error promise rejection captured": React Query abort chatter
    //   - Network fetch errors for offline/slow clients (ChunkLoadError etc.)
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
      'Non-Error exception captured',
      'Failed to fetch',
      'Load failed',
      'NetworkError when attempting to fetch resource',
      'cancelled',
      'AbortError',
      /ChunkLoadError/,
      /Loading chunk \d+ failed/,
    ],

    // Mirror backend behaviour: drop 401 / 404 even when they arrive with
    // a structured status code.
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
// Else: completely silent. No init, no warnings, no telemetry.
