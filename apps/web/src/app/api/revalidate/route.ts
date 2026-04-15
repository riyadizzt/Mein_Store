import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'

/**
 * Cache-invalidation endpoint for the storefront.
 *
 * The NestJS API calls this after mutating data that's cached in the
 * Next.js data layer (products.service.ts findOne() uses
 * `next: { revalidate: 10 }`, so a soft-deleted product would otherwise
 * stay visible for up to 10 seconds after the admin clicks delete).
 *
 * Request shape:
 *   POST /api/revalidate
 *   { "paths": ["/de/products/slug-xyz", "/ar/products/slug-xyz"],
 *     "secret": "<REVALIDATE_SECRET>" }
 *
 * Auth: shared secret via REVALIDATE_SECRET env var. When the env var is
 * not set (local dev, staging where nobody configured it), the endpoint
 * returns 503 and the NestJS caller logs a warn but does NOT fail the
 * parent operation. So forgetting to configure the secret degrades
 * gracefully to "same behaviour as before" — stale cache for 10s — and
 * never blocks a delete or any other mutation.
 *
 * Only concrete "/..." paths are revalidated; anything else is silently
 * dropped so a bad caller can't accidentally nuke the whole cache.
 */
export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { paths, secret } = (body ?? {}) as { paths?: unknown; secret?: unknown }

  const expected = process.env.REVALIDATE_SECRET
  if (!expected) {
    return NextResponse.json(
      { error: 'REVALIDATE_SECRET not configured on web app' },
      { status: 503 },
    )
  }
  if (typeof secret !== 'string' || secret !== expected) {
    return NextResponse.json({ error: 'Invalid secret' }, { status: 401 })
  }
  if (!Array.isArray(paths)) {
    return NextResponse.json({ error: 'paths must be an array' }, { status: 400 })
  }

  let revalidated = 0
  const skipped: string[] = []
  for (const p of paths) {
    if (typeof p === 'string' && p.startsWith('/')) {
      try {
        revalidatePath(p)
        revalidated++
      } catch (e: any) {
        skipped.push(`${p}: ${e?.message ?? 'error'}`)
      }
    }
  }

  return NextResponse.json({ revalidated, skipped })
}
