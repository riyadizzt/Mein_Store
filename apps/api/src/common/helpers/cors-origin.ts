/**
 * CORS origin matcher — multi-origin whitelist with optional Vercel
 * preview regex. Isolated as a pure helper so both the Nest app and
 * unit tests can consume it without spinning up HTTP.
 *
 * Inputs (env):
 *   NEXT_PUBLIC_APP_URL            primary canonical origin (always allowed)
 *   CORS_ALLOWED_ORIGINS           optional comma-separated list
 *   CORS_ALLOW_VERCEL_PREVIEWS     'true' → allow *.vercel.app previews
 *                                  matching the project's preview pattern
 *
 * The no-origin branch (!origin) is a DELIBERATE allow: webhooks, curl,
 * Postman, server-to-server traffic carry no Origin header and must
 * reach their endpoints (signature-verified at the route level).
 */

// Anchored. `[a-z0-9-]+` segments must be non-empty. Trailing `.vercel.app`
// is literal — no wildcard — so `malak-bekleidung-git-x.vercel.app.evil.com`
// does NOT match (the $ anchor requires the string end at .vercel.app).
const VERCEL_PREVIEW_RE =
  /^https:\/\/malak-bekleidung-git-[a-z0-9-]+-[a-z0-9-]+\.vercel\.app$/

export function buildCorsAllowlist(env: NodeJS.ProcessEnv = process.env): {
  exact: Set<string>
  regexes: RegExp[]
} {
  const exact = new Set<string>()
  if (env.NEXT_PUBLIC_APP_URL) exact.add(env.NEXT_PUBLIC_APP_URL)

  const extras = (env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const e of extras) exact.add(e)

  // Dev-fallback only kicks in if nothing else is configured.
  // In production, Railway env always supplies NEXT_PUBLIC_APP_URL.
  if (exact.size === 0) exact.add('http://localhost:3000')

  const regexes: RegExp[] = []
  if (env.CORS_ALLOW_VERCEL_PREVIEWS === 'true') {
    regexes.push(VERCEL_PREVIEW_RE)
  }
  return { exact, regexes }
}

export function makeCorsOriginFn(
  env: NodeJS.ProcessEnv = process.env,
): (
  origin: string | undefined,
  cb: (err: Error | null, allow?: boolean) => void,
) => void {
  const { exact, regexes } = buildCorsAllowlist(env)
  return (origin, cb) => {
    // No origin = server-to-server / webhook / curl / Postman → allow.
    // Browser requests always carry an Origin header.
    if (!origin) return cb(null, true)
    if (exact.has(origin)) return cb(null, true)
    if (regexes.some((r) => r.test(origin))) return cb(null, true)
    return cb(new Error(`Origin not allowed by CORS: ${origin}`))
  }
}
