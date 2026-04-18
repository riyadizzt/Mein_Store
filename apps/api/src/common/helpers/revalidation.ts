/**
 * Web-layer cache invalidation helper — R13.
 *
 * Thin fire-and-forget wrapper around the storefront's /api/revalidate
 * endpoint. Used by reservation.service (and anywhere else stock-affecting
 * mutations happen) to keep PDP + catalog ISR cache entries fresh without
 * waiting for the revalidate window.
 *
 * Guarantees:
 *   1. Caller NEVER blocks on network — returns a Promise that's swallowed
 *      at call sites via `.catch(() => {})`.
 *   2. Caller NEVER throws — all errors (missing secret, HTTP failure,
 *      timeout) are silently logged to console.warn so reservation
 *      transactions are never aborted by a cache layer issue.
 *   3. Missing `REVALIDATE_SECRET` env var → no-op (graceful degradation
 *      for local dev + CI where web isn't reachable).
 *   4. Short timeout (3s) so a hung web app can't DoS the API.
 *
 * Usage:
 *   await revalidateProductTags(prisma, [variantId1, variantId2])
 *     .catch(() => {})  // explicit swallow — never let this throw upstream
 */

import type { PrismaClient } from '@prisma/client'

const REVALIDATE_TIMEOUT_MS = 3000
const PRODUCTS_LIST_TAG = 'products:list' as const

function productTag(slug: string): string {
  return `product:${slug}`
}

/**
 * Posts the given tags to the storefront. Swallows all errors.
 *
 * Exported separately so non-variant callers (e.g. admin-products.service on
 * bulk delete) can push arbitrary tags without going through the variant
 * resolution step.
 */
export async function postRevalidateTags(tags: string[]): Promise<void> {
  const secret = process.env.REVALIDATE_SECRET
  if (!secret) return
  if (!Array.isArray(tags) || tags.length === 0) return
  const webUrl = process.env.WEB_BASE_URL ?? 'http://localhost:3000'

  try {
    const res = await fetch(`${webUrl}/api/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags, secret }),
      signal: AbortSignal.timeout(REVALIDATE_TIMEOUT_MS),
    })
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[revalidate] HTTP ${res.status} for tags=${tags.join(',')}`)
    }
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.warn(`[revalidate] Failed: ${err?.message ?? err}`)
  }
}

/**
 * Resolves variantIds → product slugs → tags, then fires the revalidate
 * request. One DB query regardless of how many variants are passed.
 *
 * Safe to call from any service, any mutation path. Failures are logged
 * and swallowed — the caller never has to worry about them.
 */
export async function revalidateProductTags(
  prisma: Pick<PrismaClient, 'productVariant'>,
  variantIds: (string | null | undefined)[],
): Promise<void> {
  try {
    const ids = variantIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
    if (ids.length === 0) return

    const variants = await prisma.productVariant.findMany({
      where: { id: { in: ids } },
      select: { product: { select: { slug: true } } },
    })
    const slugs = new Set<string>()
    for (const v of variants) {
      if (v.product?.slug) slugs.add(v.product.slug)
    }
    if (slugs.size === 0) return

    const tags: string[] = [PRODUCTS_LIST_TAG]
    for (const slug of slugs) tags.push(productTag(slug))

    await postRevalidateTags(tags)
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.warn(`[revalidate] variant-resolution failed: ${err?.message ?? err}`)
  }
}
