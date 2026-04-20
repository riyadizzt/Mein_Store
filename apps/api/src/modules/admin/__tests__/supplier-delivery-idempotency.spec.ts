/**
 * Item-level idempotency regression for Wareneingang (createDelivery).
 *
 * Bug B1 from the 2026-04-20 audit: pre-refactor, nothing stopped the
 * same SupplierDeliveryItem from producing two InventoryMovement rows
 * on retry. The partial unique index introduced by migration
 * 20260420_supplier_delivery_item_unique enforces "at most one
 * InventoryMovement per (SupplierDeliveryItem.id, variantId)
 * WHERE type='supplier_delivery'", and the service translates the
 * resulting P2002 into a friendly 409 ConflictException.
 *
 * What these tests pin down:
 *   1. P2002 from the index → ConflictException with error code
 *      'SupplierDeliveryItemAlreadyBooked' and 3-lang message
 *   2. Error code 'SupplierDeliveryItemAlreadyBooked' is exactly this
 *      string (the UI banner branches on it)
 *   3. Non-P2002 errors are NOT swallowed into the friendly response —
 *      they surface so real bugs aren't hidden
 *   4. Multiple items in one delivery each get their own
 *      SupplierDeliveryItem.id → no collision within a legitimate call
 */

import { ConflictException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { AdminSuppliersService } from '../services/admin-suppliers.service'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJest = jest.Mock<any, any>

function buildPrisma() {
  const mock: any = {
    supplier: { findUnique: jest.fn().mockResolvedValue({ id: 'sup1', name: 'Sup', isActive: true }) },
    warehouse: {
      findFirst: jest.fn().mockResolvedValue({ id: 'wh1', name: 'Marzahn', isActive: true, isDefault: true }),
      findUnique: jest.fn().mockResolvedValue({ id: 'wh1', name: 'Marzahn', isActive: true, isDefault: true }),
    },
    productVariant: {
      findMany: jest.fn().mockImplementation(async (args: any) => {
        const ids: string[] = args?.where?.id?.in ?? []
        const isLight = !!args?.select
        return isLight
          ? ids.map((id) => ({ id, sku: `SKU-${id}`, isActive: true }))
          : ids.map((id) => ({
              id, sku: `SKU-${id}`, color: null, size: null, purchasePrice: 5,
              product: { id: `p-${id}`, translations: [{ name: `Product ${id}` }] },
            }))
      }),
      update: jest.fn(),
      create: jest.fn(),
    },
    product: { create: jest.fn() },
    category: { findFirst: jest.fn() },
    inventory: {
      findFirst: jest.fn().mockResolvedValue({ id: 'inv1', variantId: 'v1', warehouseId: 'wh1', quantityOnHand: 10 }),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 'inv1', variantId: 'v1', warehouseId: 'wh1', quantityOnHand: 12 }),
    },
    inventoryMovement: { create: jest.fn().mockResolvedValue({ id: 'mov1' }) },
    supplierDelivery: {
      create: jest.fn().mockResolvedValue({
        id: 'del1', deliveryNumber: 'WE-2026-00001',
        items: [{ id: 'di1', variantId: 'v1', quantity: 1 }],
      }),
    },
    supplierDeliverySequence: { upsert: jest.fn().mockResolvedValue({ id: 'singleton', year: 2026, lastNum: 1 }), update: jest.fn() },
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

describe('AdminSuppliersService.createDelivery — item-level idempotency (Gruppe 1, B1)', () => {
  it('#1 P2002 from the partial unique index → 409 SupplierDeliveryItemAlreadyBooked', async () => {
    const prisma = buildPrisma()
    // Simulate the unique-index violation on the second
    // inventoryMovement.create (same deliveryItem.id + variantId collision).
    ;(prisma.inventoryMovement.create as AnyJest).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['reference_id', 'variant_id'] },
      }),
    )

    const service = buildService(prisma)

    let caught: any
    try {
      await service.createDelivery(
        { supplierId: 'sup1', existingItems: [{ variantId: 'v1', quantity: 1 }] },
        'admin1', '127.0.0.1',
      )
    } catch (e) { caught = e }

    expect(caught).toBeInstanceOf(ConflictException)
    expect(caught.response?.statusCode).toBe(409)
    expect(caught.response?.error).toBe('SupplierDeliveryItemAlreadyBooked')
    // 3-lang message for the admin-facing banner
    expect(caught.response?.message?.de).toContain('bereits gebucht')
    expect(caught.response?.message?.en).toContain('already been booked')
    expect(caught.response?.message?.ar).toContain('بالفعل')
  })

  it('#2 non-P2002 errors are NOT translated (propagate as-is)', async () => {
    const prisma = buildPrisma()
    ;(prisma.inventoryMovement.create as AnyJest).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Foreign key violation', {
        code: 'P2003',
        clientVersion: '5.22.0',
      }),
    )

    const service = buildService(prisma)

    let caught: any
    try {
      await service.createDelivery(
        { supplierId: 'sup1', existingItems: [{ variantId: 'v1', quantity: 1 }] },
        'admin1', '127.0.0.1',
      )
    } catch (e) { caught = e }

    expect(caught).toBeInstanceOf(Prisma.PrismaClientKnownRequestError)
    expect(caught.code).toBe('P2003')
    // Must NOT be dressed up as the idempotency-conflict response
    expect(caught).not.toBeInstanceOf(ConflictException)
  })

  it('#3 generic Error (not a Prisma error) propagates untouched', async () => {
    const prisma = buildPrisma()
    ;(prisma.inventoryMovement.create as AnyJest).mockRejectedValue(new Error('connection reset'))

    const service = buildService(prisma)

    await expect(
      service.createDelivery(
        { supplierId: 'sup1', existingItems: [{ variantId: 'v1', quantity: 1 }] },
        'admin1', '127.0.0.1',
      ),
    ).rejects.toThrow('connection reset')
  })

  it('#4 multiple items in one delivery: each gets its own SupplierDeliveryItem.id → no collision', async () => {
    const prisma = buildPrisma()
    ;(prisma.supplierDelivery.create as AnyJest).mockResolvedValue({
      id: 'del1', deliveryNumber: 'WE-2026-00001',
      items: [
        { id: 'di1', variantId: 'v1', quantity: 2 },
        { id: 'di2', variantId: 'v2', quantity: 3 },
        { id: 'di3', variantId: 'v3', quantity: 5 },
      ],
    })

    const service = buildService(prisma)
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

    // 3 separate movements, each referencing its own SupplierDeliveryItem.id
    expect((prisma.inventoryMovement.create as AnyJest)).toHaveBeenCalledTimes(3)
    const createCalls = (prisma.inventoryMovement.create as AnyJest).mock.calls
    const referenceIds = createCalls.map((c: any) => c[0].data.referenceId)
    expect(referenceIds).toEqual(['di1', 'di2', 'di3'])
    // All distinct → partial unique index (reference_id, variant_id)
    // would never collide on a healthy multi-line delivery
    expect(new Set(referenceIds).size).toBe(3)
  })
})
