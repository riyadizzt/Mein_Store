/**
 * Seed Inventory rows for a new ProductVariant across all active warehouses.
 *
 * Why this exists
 * ---------------
 * Pre-hardening, the three variant-creation call sites (products.service.create,
 * admin-products.service.addColor, admin-products.service.addSize) wrote a
 * single Inventory row in the default warehouse. Any product that existed in
 * multiple warehouses would see its new color/size variant "invisible" in the
 * non-default warehouses — the UI showed it but the admin couldn't book stock
 * there until someone manually created a zero-qty row.
 *
 * Contract
 * --------
 *   - For every active warehouse that does NOT already have an Inventory row
 *     for (variantId, warehouseId), create one.
 *   - The row gets `quantityOnHand = initialStockByWarehouseId[warehouseId]`
 *     if that warehouse appears in the map, otherwise 0.
 *   - Idempotent on re-run — the existence check means calling the helper
 *     twice in one transaction doesn't create duplicates.
 *
 * Shape
 * -----
 * Accepts either the global PrismaService or a TransactionClient so the
 * call site can chain it into an outer $transaction. Returns the number of
 * rows actually created so the caller can log / audit if they want.
 */

import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'

export async function seedInventoryAcrossWarehouses(
  client: PrismaService | Prisma.TransactionClient,
  variantId: string,
  initialStockByWarehouseId: Record<string, number> = {},
): Promise<{ created: number; warehouseIds: string[] }> {
  const activeWarehouses = await client.warehouse.findMany({
    where: { isActive: true },
    select: { id: true },
  })

  if (activeWarehouses.length === 0) {
    return { created: 0, warehouseIds: [] }
  }

  const warehouseIds = activeWarehouses.map((w) => w.id)

  // Find which warehouses already have a row for this variant.
  // Second-insert is a non-issue (the compound unique on
  // variant_id+warehouse_id would reject it), but skipping pre-existing
  // rows avoids both a P2002 noise and any accidental `quantityOnHand`
  // overwrite on an existing stock row.
  const existing = await client.inventory.findMany({
    where: { variantId, warehouseId: { in: warehouseIds } },
    select: { warehouseId: true },
  })
  const alreadySeeded = new Set(existing.map((e) => e.warehouseId))

  let created = 0
  const touched: string[] = []
  for (const whId of warehouseIds) {
    if (alreadySeeded.has(whId)) continue
    await client.inventory.create({
      data: {
        variantId,
        warehouseId: whId,
        quantityOnHand: initialStockByWarehouseId[whId] ?? 0,
      },
    })
    created++
    touched.push(whId)
  }

  return { created, warehouseIds: touched }
}
