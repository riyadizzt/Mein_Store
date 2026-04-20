/**
 * Pre-write barcode-uniqueness gate for ProductVariant.
 *
 * Why this exists
 * ---------------
 * The DB has `barcode String? @unique` on ProductVariant — a write that
 * collides on an existing barcode throws Prisma P2002, which the admin
 * sees as a cryptic 500. This helper runs BEFORE the write, looks up any
 * colliding variant, and returns structured context so the caller can
 * throw a 3-language 400 with the conflicting product/SKU name instead.
 *
 * Contract
 * --------
 *   - Null / empty / whitespace barcode → no-op (returns { ok: true }).
 *     The barcode field is optional; only collisions on non-empty values
 *     are a problem.
 *   - For an Update, pass `excludeVariantId` so the check ignores the
 *     row being updated (otherwise every no-op update of an untouched
 *     row would reject itself).
 *   - Uses findFirst so a caller can pass a TransactionClient — the check
 *     still participates in the outer transaction's snapshot.
 *
 * Shape
 * -----
 *   { ok: true }                                             → proceed with write
 *   { ok: false, conflictVariantId, conflictSku, conflictProductName }
 *                                                            → caller throws 400
 */

import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'

export interface BarcodeUniquenessResult {
  ok: boolean
  conflictVariantId?: string
  conflictSku?: string | null
  conflictProductName?: string
}

export async function checkBarcodeUniqueness(
  client: PrismaService | Prisma.TransactionClient,
  barcode: string | null | undefined,
  excludeVariantId?: string,
): Promise<BarcodeUniquenessResult> {
  // Empty / whitespace / null — nothing to check.
  const trimmed = barcode?.trim()
  if (!trimmed) return { ok: true }

  const existing = await client.productVariant.findFirst({
    where: {
      barcode: trimmed,
      ...(excludeVariantId ? { NOT: { id: excludeVariantId } } : {}),
    },
    select: {
      id: true,
      sku: true,
      product: {
        select: {
          translations: { select: { language: true, name: true } },
        },
      },
    },
  })

  if (!existing) return { ok: true }

  // Prefer the German translation for the admin-facing error (admin UI is
  // multi-lang but the identifying name should be stable); fall back to the
  // first available translation or the SKU as a last resort.
  const translations = existing.product?.translations ?? []
  const de = translations.find((t) => t.language === 'de')?.name
  const first = translations[0]?.name
  const productName = de ?? first ?? existing.sku ?? '(unbekannt)'

  return {
    ok: false,
    conflictVariantId: existing.id,
    conflictSku: existing.sku,
    conflictProductName: productName,
  }
}
