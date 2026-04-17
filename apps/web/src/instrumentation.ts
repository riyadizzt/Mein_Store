/**
 * Next.js 14 instrumentation hook.
 *
 * Called ONCE per Next.js server process before handling requests. We use
 * it to conditionally load the correct Sentry config based on the runtime
 * (nodejs vs edge). This is the official Next.js pattern for early bootstrap
 * instrumentation.
 *
 * sentry.client.config.ts is NOT loaded here — Next.js auto-loads it for
 * the browser bundle via the @sentry/nextjs webpack plugin.
 *
 * Graceful degradation: each config file has its own `if (dsn) Sentry.init()`
 * guard. If no DSN is configured, these imports are essentially no-ops.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config')
  }
}

/**
 * Called by Next.js when a server-side error is caught (app-router only).
 * We forward it to Sentry explicitly here so "caught by error boundary"
 * events get reported too.
 */
export async function onRequestError(
  err: unknown,
  request: {
    path: string
    method: string
    headers: { [key: string]: string | string[] | undefined }
  },
  context: {
    routerKind: 'Pages Router' | 'App Router'
    routePath: string
    routeType: 'render' | 'route' | 'action' | 'middleware'
    renderSource?:
      | 'react-server-components'
      | 'react-server-components-payload'
      | 'server-rendering'
    revalidateReason?: 'on-demand' | 'stale' | undefined
    renderType?: 'dynamic' | 'dynamic-resume'
  },
): Promise<void> {
  // Only call Sentry if it's actually initialized (gracefully-degraded case).
  const mod = await import('@sentry/nextjs')
  if (!mod.getClient()) return
  mod.captureRequestError(err, request, context)
}
