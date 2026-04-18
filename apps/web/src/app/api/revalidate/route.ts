import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'

/**
 * Cache-invalidation endpoint for the storefront.
 *
 * Two invalidation modes (combinable in one request):
 *   - `paths`: revalidate hard-coded Next.js URLs (legacy)
 *   - `tags`:  revalidate fetches that opted into `next: { tags: [...] }`
 *             (R13 — reservation-lifecycle → product-tag invalidation)
 *
 * Request shape:
 *   POST /api/revalidate
 *   { "paths": ["/de/products/slug", ...], "tags": ["product:slug"],
 *     "secret": "<REVALIDATE_SECRET>" }
 *
 * Auth: shared secret via REVALIDATE_SECRET env var (unchanged). When the
 * env var is not set, the endpoint returns 503 and the NestJS caller logs a
 * warn but does NOT fail the parent operation — so forgetting to configure
 * the secret degrades gracefully to "same behaviour as before" (stale cache
 * for its normal window) and never blocks a reservation or a delete.
 *
 * Tag-based invalidation lets the backend notify the web without knowing
 * every concrete URL. The PDP opts in with `next: { tags: [`product:${slug}`] }`
 * so one tag invalidates all locale variants + the list page that shares
 * the same tag.
 */
export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { paths, tags, secret } = (body ?? {}) as {
    paths?: unknown
    tags?: unknown
    secret?: unknown
  }

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
  if (!Array.isArray(paths) && !Array.isArray(tags)) {
    return NextResponse.json({ error: 'paths or tags must be an array' }, { status: 400 })
  }

  let revalidatedPaths = 0
  let revalidatedTags = 0
  const skipped: string[] = []

  if (Array.isArray(paths)) {
    for (const p of paths) {
      if (typeof p === 'string' && p.startsWith('/')) {
        try {
          revalidatePath(p)
          revalidatedPaths++
        } catch (e: any) {
          skipped.push(`path ${p}: ${e?.message ?? 'error'}`)
        }
      }
    }
  }

  if (Array.isArray(tags)) {
    // Safety cap — even with valid secret, don't let a single call blow up
    // the cache if upstream sends garbage.
    const safeTags = tags.slice(0, 100)
    for (const t of safeTags) {
      if (typeof t !== 'string' || t.length === 0 || t.length > 200) continue
      try {
        revalidateTag(t)
        revalidatedTags++
      } catch (e: any) {
        skipped.push(`tag ${t}: ${e?.message ?? 'error'}`)
      }
    }
  }

  return NextResponse.json({
    revalidatedPaths,
    revalidatedTags,
    // Legacy callers read `revalidated` (number) — keep the shape alive
    revalidated: revalidatedPaths,
    skipped,
  })
}
