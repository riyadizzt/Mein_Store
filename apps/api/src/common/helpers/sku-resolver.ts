/**
 * SKU collision resolver.
 *
 * The product-wizard generates deterministic SKUs from
 *   `MAL-<slug6>-<color3>-<size>`
 * which means two products with a similar slug prefix (e.g. "herren-schuhe"
 * vs. "herren-schue") produce identical SKUs. Prisma's `sku String @unique`
 * constraint then throws P2002 on the second create → 500 at the API boundary.
 *
 * This helper detects the collision before the insert and appends a `-002`,
 * `-003` ... suffix until it finds a free slot. The original slug/color/size
 * part is NOT touched — only a numeric suffix is appended — so the SKU stays
 * human-readable and its prefix still predicts the variant shape.
 *
 * The suffix starts at 002 (not 001) because the first unsuffixed slot is
 * conceptually "001" already. Safety cap at 999 — if 999 of the same shape
 * exist the system is clearly broken and a hard error is correct.
 *
 * Non-transactional: a racing insert between `findFirst` and the final
 * `create` can still trip the unique constraint. The caller should wrap the
 * overall flow in a retry loop if race-safety matters.
 */

import { PrismaService } from '../../prisma/prisma.service'

const MAX_SUFFIX = 999

export interface SkuAdjustment {
  /** SKU originally requested by the wizard / client. */
  original: string
  /** SKU that was actually used in the DB after collision resolution. */
  final: string
}

/**
 * Resolve a single SKU. Returns the original if no collision, otherwise a
 * suffixed version. Throws if we exhaust MAX_SUFFIX.
 *
 * The `reservedInThisRequest` parameter lets the caller prevent the helper
 * from returning a SKU that another variant in the SAME create-call just
 * claimed. Without it, two variants with the same base SKU in one payload
 * (e.g. admin ticked the same color+size twice) would both return the same
 * "free" slot, and only the first insert would succeed.
 */
export async function resolveUniqueSku(
  prisma: PrismaService,
  baseSku: string,
  reservedInThisRequest: Set<string>,
): Promise<string> {
  // First attempt: the raw SKU, if it's free AND nobody else in this
  // request has already claimed it.
  if (!reservedInThisRequest.has(baseSku)) {
    const existing = await prisma.productVariant.findFirst({
      where: { sku: baseSku },
      select: { id: true },
    })
    if (!existing) {
      reservedInThisRequest.add(baseSku)
      return baseSku
    }
  }

  // Collision. Start at 002 (the unsuffixed slot is "001").
  for (let n = 2; n <= MAX_SUFFIX; n++) {
    const candidate = `${baseSku}-${String(n).padStart(3, '0')}`
    if (reservedInThisRequest.has(candidate)) continue
    const existing = await prisma.productVariant.findFirst({
      where: { sku: candidate },
      select: { id: true },
    })
    if (!existing) {
      reservedInThisRequest.add(candidate)
      return candidate
    }
  }

  throw new Error(
    `resolveUniqueSku: exhausted ${MAX_SUFFIX} suffixes for base "${baseSku}". ` +
    `This usually means the SKU generator is producing a non-unique prefix — ` +
    `check the wizard's slug slicing or the input data.`,
  )
}

/**
 * Resolve an array of SKUs in one pass, tracking which ones were changed.
 * Returns both the resolved SKU array (same order as input) and the list
 * of adjustments so the frontend can show a toast.
 */
export async function resolveUniqueSkus(
  prisma: PrismaService,
  baseSkus: string[],
): Promise<{ resolved: string[]; adjustments: SkuAdjustment[] }> {
  const reserved = new Set<string>()
  const resolved: string[] = []
  const adjustments: SkuAdjustment[] = []

  for (const base of baseSkus) {
    const final = await resolveUniqueSku(prisma, base, reserved)
    resolved.push(final)
    if (final !== base) {
      adjustments.push({ original: base, final })
    }
  }

  return { resolved, adjustments }
}
