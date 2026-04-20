/**
 * Unit tests for seedInventoryAcrossWarehouses — the shared helper that
 * guarantees every new ProductVariant has an Inventory row in every
 * active warehouse, not just the default one.
 *
 * Bug B3 from the 2026-04-20 audit: pre-hardening, addColor/addSize and
 * product-create wrote a single Inventory row in the default warehouse.
 * Products in multi-warehouse deployments had invisible variants in
 * non-default warehouses until someone manually created a zero-qty row.
 *
 * Fix: one helper, called from four call-sites (create + addColor + addSize
 * + updateVariant repair path). These tests pin the helper's contract so
 * any future regression shows up here immediately.
 */

import { seedInventoryAcrossWarehouses } from '../inventory-seed'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJest = jest.Mock<any, any>

function buildClient(opts: {
  warehouses: Array<{ id: string; isActive?: boolean }>
  existingInventory?: Array<{ warehouseId: string }>
}): { warehouse: { findMany: AnyJest }; inventory: { findMany: AnyJest; create: AnyJest } } {
  return {
    warehouse: {
      findMany: jest.fn().mockResolvedValue(
        opts.warehouses.filter((w) => w.isActive !== false).map((w) => ({ id: w.id })),
      ),
    },
    inventory: {
      findMany: jest.fn().mockResolvedValue(opts.existingInventory ?? []),
      create: jest.fn().mockResolvedValue({}),
    },
  }
}

describe('seedInventoryAcrossWarehouses (Gruppe 2, B3)', () => {
  it('#1 two active warehouses → creates two inventory rows for a new variant', async () => {
    const client = buildClient({
      warehouses: [{ id: 'wh-marzahn' }, { id: 'wh-pannier' }],
    })

    const result = await seedInventoryAcrossWarehouses(client as any, 'v-new')

    expect(result.created).toBe(2)
    expect(result.warehouseIds.sort()).toEqual(['wh-marzahn', 'wh-pannier'])
    expect(client.inventory.create).toHaveBeenCalledTimes(2)
    // Both rows default to qty=0 when no initialStockMap provided
    for (const call of client.inventory.create.mock.calls) {
      expect(call[0].data.quantityOnHand).toBe(0)
    }
  })

  it('#2 initial stock lands only in the specified warehouse, others get 0', async () => {
    const client = buildClient({
      warehouses: [{ id: 'wh-default' }, { id: 'wh-store' }],
    })

    const result = await seedInventoryAcrossWarehouses(
      client as any,
      'v-new',
      { 'wh-default': 50 },
    )

    expect(result.created).toBe(2)
    const calls = client.inventory.create.mock.calls
    const byWh = new Map(calls.map((c: any) => [c[0].data.warehouseId, c[0].data.quantityOnHand]))
    expect(byWh.get('wh-default')).toBe(50)
    expect(byWh.get('wh-store')).toBe(0)
  })

  it('#3 inactive warehouse is skipped', async () => {
    const client = buildClient({
      warehouses: [
        { id: 'wh-active' },
        { id: 'wh-inactive', isActive: false },
      ],
    })

    const result = await seedInventoryAcrossWarehouses(client as any, 'v-new')

    expect(result.created).toBe(1)
    expect(result.warehouseIds).toEqual(['wh-active'])
  })

  it('#4 idempotent re-run: existing rows are respected, not duplicated', async () => {
    // If the helper is invoked twice in a row for the same variant (e.g.
    // addColor called on a product after product-create already seeded
    // inventory), the second call must not create duplicates.
    const client = buildClient({
      warehouses: [{ id: 'wh-marzahn' }, { id: 'wh-pannier' }],
      existingInventory: [{ warehouseId: 'wh-marzahn' }],  // marzahn already has a row
    })

    const result = await seedInventoryAcrossWarehouses(client as any, 'v-existing')

    expect(result.created).toBe(1)
    expect(result.warehouseIds).toEqual(['wh-pannier'])
    expect(client.inventory.create).toHaveBeenCalledTimes(1)
    // The one create call is for pannier only — marzahn is respected as-is
    expect(client.inventory.create.mock.calls[0][0].data.warehouseId).toBe('wh-pannier')
  })

  it('#5 zero active warehouses → no-op, not an error', async () => {
    const client = buildClient({ warehouses: [] })

    const result = await seedInventoryAcrossWarehouses(client as any, 'v-new')

    expect(result.created).toBe(0)
    expect(result.warehouseIds).toEqual([])
    expect(client.inventory.create).not.toHaveBeenCalled()
  })
})
