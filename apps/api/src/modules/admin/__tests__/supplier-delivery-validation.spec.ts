/**
 * Pre-validation regression for Wareneingang (createDelivery).
 *
 * Bugs B4 + B5 from the 2026-04-20 audit: pre-refactor, invalid rows
 * were silently skipped (line 394: `if (!variant) continue`) and there
 * was no upper bound on line quantities. Admin submitted 20 lines with
 * 3 typos, got back "processed: 17" without knowing which 3 were
 * silently dropped.
 *
 * New contract: validate ALL lines up-front, reject the WHOLE delivery
 * with a structured 400 + per-line error list. All-or-nothing semantic
 * (Entscheidung Frage 3 → Option A). Admin fixes the file and resubmits.
 *
 * Each test also asserts no writes occurred — the validation phase must
 * run BEFORE the transaction opens, so an invalid input must not even
 * touch `$transaction`.
 */

import { BadRequestException } from '@nestjs/common'
import { AdminSuppliersService } from '../services/admin-suppliers.service'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJest = jest.Mock<any, any>

function buildPrisma(activeWarehouse = true) {
  const mock: any = {
    supplier: { findUnique: jest.fn().mockResolvedValue({ id: 'sup1', name: 'Sup', isActive: true }) },
    warehouse: {
      findFirst: jest.fn().mockResolvedValue({ id: 'wh1', name: 'Marzahn', isActive: activeWarehouse, isDefault: true }),
      findUnique: jest.fn().mockResolvedValue({ id: 'wh1', name: 'Marzahn', isActive: activeWarehouse, isDefault: true }),
    },
    productVariant: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      create: jest.fn(),
    },
    product: { create: jest.fn() },
    category: { findFirst: jest.fn() },
    inventory: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    inventoryMovement: { create: jest.fn() },
    supplierDelivery: { create: jest.fn() },
    supplierDeliverySequence: { upsert: jest.fn(), update: jest.fn() },
    skuSequence: { upsert: jest.fn() },
  }
  mock.$transaction = jest.fn().mockImplementation(async (arg: any) => {
    if (typeof arg === 'function') return arg(mock)
    return Promise.all(arg)
  })
  return mock
}

function buildService(prisma: any): AdminSuppliersService {
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as any
  return new AdminSuppliersService(prisma as any, audit)
}

function expectNoWrites(prisma: any) {
  expect(prisma.$transaction).not.toHaveBeenCalled()
  expect(prisma.supplierDelivery.create).not.toHaveBeenCalled()
  expect(prisma.inventoryMovement.create).not.toHaveBeenCalled()
  expect(prisma.inventory.update).not.toHaveBeenCalled()
  expect(prisma.inventory.create).not.toHaveBeenCalled()
}

describe('AdminSuppliersService.createDelivery — pre-validation (Gruppe 1, B4+B5)', () => {
  it('#1 invalid variantId: 400 with per-row error list, no writes', async () => {
    const prisma = buildPrisma()
    // Pre-validation findMany returns fewer rows than requested → "not_found" errors
    ;(prisma.productVariant.findMany as AnyJest).mockResolvedValue([
      { id: 'v1', sku: 'SKU-v1', isActive: true },
      // v2 + v3 missing
    ])

    const service = buildService(prisma)

    let caught: any
    try {
      await service.createDelivery(
        {
          supplierId: 'sup1',
          existingItems: [
            { variantId: 'v1', quantity: 2 },
            { variantId: 'v2', quantity: 3 },
            { variantId: 'v3', quantity: 5 },
          ],
        },
        'admin1', '127.0.0.1',
      )
    } catch (e) { caught = e }

    expect(caught).toBeInstanceOf(BadRequestException)
    expect(caught.response?.error).toBe('DeliveryValidationFailed')
    const errors = caught.response?.data?.errors ?? []
    expect(errors.length).toBe(2)
    expect(errors.map((e: any) => e.reason)).toContain('not_found')
    expect(errors.map((e: any) => e.field)).toContain('variantId')
    expectNoWrites(prisma)
  })

  it('#2 quantity = 0 on an existing item → 400 non_positive', async () => {
    const prisma = buildPrisma()
    ;(prisma.productVariant.findMany as AnyJest).mockResolvedValue([
      { id: 'v1', sku: 'SKU-v1', isActive: true },
    ])

    const service = buildService(prisma)

    let caught: any
    try {
      await service.createDelivery(
        { supplierId: 'sup1', existingItems: [{ variantId: 'v1', quantity: 0 }] },
        'admin1', '127.0.0.1',
      )
    } catch (e) { caught = e }

    expect(caught?.response?.error).toBe('DeliveryValidationFailed')
    const reasons = caught.response?.data?.errors?.map((e: any) => e.reason)
    expect(reasons).toContain('non_positive')
    expectNoWrites(prisma)
  })

  it('#3 quantity = -5 → 400 non_positive', async () => {
    const prisma = buildPrisma()
    ;(prisma.productVariant.findMany as AnyJest).mockResolvedValue([
      { id: 'v1', sku: 'SKU-v1', isActive: true },
    ])

    const service = buildService(prisma)

    let caught: any
    try {
      await service.createDelivery(
        { supplierId: 'sup1', existingItems: [{ variantId: 'v1', quantity: -5 }] },
        'admin1', '127.0.0.1',
      )
    } catch (e) { caught = e }

    expect(caught.response?.data?.errors?.[0]?.reason).toBe('non_positive')
    expectNoWrites(prisma)
  })

  it('#4 quantity = 10001 → 400 exceeds_cap_10000 (typo protection)', async () => {
    const prisma = buildPrisma()
    ;(prisma.productVariant.findMany as AnyJest).mockResolvedValue([
      { id: 'v1', sku: 'SKU-v1', isActive: true },
    ])

    const service = buildService(prisma)

    let caught: any
    try {
      await service.createDelivery(
        { supplierId: 'sup1', existingItems: [{ variantId: 'v1', quantity: 10001 }] },
        'admin1', '127.0.0.1',
      )
    } catch (e) { caught = e }

    expect(caught.response?.data?.errors?.[0]?.reason).toBe('exceeds_cap_10000')
    expect(caught.response?.data?.maxQuantityPerLine).toBe(10000)
    expectNoWrites(prisma)
  })

  it('#5 inactive warehouse → 400 WarehouseInactive', async () => {
    const prisma = buildPrisma(/* activeWarehouse */ false)

    const service = buildService(prisma)

    let caught: any
    try {
      await service.createDelivery(
        { supplierId: 'sup1', warehouseId: 'wh1', existingItems: [{ variantId: 'v1', quantity: 1 }] },
        'admin1', '127.0.0.1',
      )
    } catch (e) { caught = e }

    expect(caught.response?.error).toBe('WarehouseInactive')
    expectNoWrites(prisma)
  })

  it('#6 17 valid + 3 invalid lines → whole delivery rolled back, zero writes, 3 errors reported', async () => {
    // User decision: Option A, all-or-nothing. Even if 17 lines are
    // submit-able, a single bad row kills the whole delivery. Admin
    // must fix the file and resubmit as a single clean batch.
    const prisma = buildPrisma()
    // Return only 17 valid variants (v1..v17). v18, v19, v20 missing.
    const validIds = Array.from({ length: 17 }, (_, i) => `v${i + 1}`)
    ;(prisma.productVariant.findMany as AnyJest).mockResolvedValue(
      validIds.map((id) => ({ id, sku: `SKU-${id}`, isActive: true })),
    )

    const service = buildService(prisma)

    const items = Array.from({ length: 20 }, (_, i) => ({
      variantId: `v${i + 1}`,
      quantity: 1,
    }))

    let caught: any
    try {
      await service.createDelivery(
        { supplierId: 'sup1', existingItems: items },
        'admin1', '127.0.0.1',
      )
    } catch (e) { caught = e }

    expect(caught).toBeInstanceOf(BadRequestException)
    expect(caught.response?.error).toBe('DeliveryValidationFailed')
    const errors = caught.response?.data?.errors ?? []
    expect(errors.length).toBe(3)
    expect(errors.every((e: any) => e.reason === 'not_found')).toBe(true)
    // CRITICAL: no partial writes — all 20 lines held back
    expectNoWrites(prisma)
  })
})
