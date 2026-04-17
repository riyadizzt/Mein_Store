/**
 * Build an inventory.restock webhook payload by enriching the minimal
 * mutation data (variantId, warehouseId, delta, newQuantity) with the
 * product + warehouse + optional supplier context that n8n would
 * otherwise need a callback to fetch.
 *
 * Pure, never throws. Returns null if the variant/warehouse can't be
 * found (e.g. the variant was deleted between the mutation and this
 * call) — caller should interpret null as "skip the emit".
 */
import type { InventoryRestockPayload } from '../events'

export async function buildInventoryRestockPayload(
  prisma: any,
  params: {
    variantId: string
    warehouseId: string
    delta: number
    newQuantity: number
    source: 'intake' | 'manual_correction' | 'return'
    supplierId?: string | null
  },
): Promise<InventoryRestockPayload | null> {
  const [variant, warehouse, supplier] = await Promise.all([
    prisma.productVariant.findUnique({
      where: { id: params.variantId },
      select: {
        id: true, sku: true, color: true, size: true,
        product: {
          select: {
            id: true, slug: true,
            translations: { where: { language: 'de' }, select: { name: true }, take: 1 },
          },
        },
      },
    }),
    prisma.warehouse.findUnique({
      where: { id: params.warehouseId },
      select: { id: true, name: true },
    }),
    params.supplierId
      ? prisma.supplier.findUnique({
          where: { id: params.supplierId },
          select: { id: true, name: true },
        })
      : Promise.resolve(null),
  ])
  if (!variant || !warehouse) return null

  const productName = variant.product?.translations?.[0]?.name ?? variant.product?.slug ?? variant.sku

  return {
    productId: variant.product?.id ?? '',
    productSlug: variant.product?.slug ?? '',
    productName,
    variantId: variant.id,
    sku: variant.sku,
    warehouseId: warehouse.id,
    warehouseName: warehouse.name,
    delta: params.delta,
    newQuantity: params.newQuantity,
    supplierId: supplier?.id ?? null,
    supplierName: supplier?.name ?? null,
    source: params.source,
    occurredAt: new Date().toISOString(),
  }
}
