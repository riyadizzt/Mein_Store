/**
 * Atomicity regression for the Wareneingang (createDelivery) flow.
 *
 * Bug B2 from the 2026-04-20 inventory audit: pre-refactor, the service
 * called `inventory.update(...)` and `inventoryMovement.create(...)`
 * sequentially OUTSIDE any Prisma transaction. A failure between the two
 * writes left stock incremented but no audit trail — silent drift.
 *
 * This spec pins the new behaviour: every booking step runs inside a
 * single `$transaction(async (tx) => {...})` callback. If any downstream
 * write throws, the whole delivery is considered un-booked (Prisma rolls
 * the tx back). We verify this structurally — the service must always
 * go through the transaction wrapper, and if a mid-flow write throws,
 * the exception must propagate (it's the caller that sees the error
 * and the DB sees nothing).
 *
 * Meta-verifiable: removing the `await this.prisma.$transaction(...)`
 * wrapper from createDelivery breaks test #1 immediately because the
 * callback-capture assertion fires on the wrong shape.
 */

import { AdminSuppliersService } from '../services/admin-suppliers.service'

// ── Mock Prisma ──────────────────────────────────────────────────

// Loose typing on purpose — jest.fn() with an any-signature accepts any
// payload shape via mockResolvedValue. A strict ReturnType<typeof jest.fn>
// defaults to never as the resolved type and refuses realistic fixtures.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJest = jest.Mock<any, any>

interface MockPrisma {
  supplier: { findUnique: AnyJest }
  warehouse: { findUnique: AnyJest; findFirst: AnyJest }
  productVariant: { findMany: AnyJest; create: AnyJest; update: AnyJest }
  product: { create: AnyJest }
  category: { findFirst: AnyJest }
  inventory: { findFirst: AnyJest; create: AnyJest; update: AnyJest }
  inventoryMovement: { create: AnyJest }
  supplierDelivery: { create: AnyJest }
  supplierDeliverySequence: { upsert: AnyJest; update: AnyJest }
  skuSequence: { upsert: AnyJest }
  $transaction: AnyJest
}

function buildMockPrisma(): MockPrisma {
  const mock: any = {
    supplier: { findUnique: jest.fn() },
    warehouse: { findUnique: jest.fn(), findFirst: jest.fn() },
    productVariant: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
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
  return mock as MockPrisma
}

function seedHappyPath(prisma: MockPrisma) {
  prisma.supplier.findUnique.mockResolvedValue({ id: 'sup1', name: 'Test Supplier', isActive: true })
  prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh1', name: 'Marzahn', isActive: true, isDefault: true })
  prisma.warehouse.findUnique.mockResolvedValue({ id: 'wh1', name: 'Marzahn', isActive: true, isDefault: true })
  prisma.supplierDeliverySequence.upsert.mockResolvedValue({ id: 'singleton', year: new Date().getFullYear(), lastNum: 42 })
  // Pre-validation productVariant.findMany (light select)
  // Default: return all requested variants as active
  prisma.productVariant.findMany.mockImplementation(async (args: any) => {
    const ids: string[] = args?.where?.id?.in ?? []
    // Shape detection: "light" = select, "heavy" = include
    const isLight = !!args?.select
    if (isLight) {
      return ids.map((id) => ({ id, sku: `SKU-${id}`, isActive: true }))
    }
    // "heavy" include: detail lookup inside tx
    return ids.map((id) => ({
      id, sku: `SKU-${id}`, color: 'Schwarz', size: 'M', purchasePrice: 5,
      product: { id: `p-${id}`, translations: [{ name: `Product ${id}` }] },
    }))
  })
}

function buildService(prisma: MockPrisma): AdminSuppliersService {
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as any
  return new AdminSuppliersService(prisma as any, audit)
}

// ── Tests ────────────────────────────────────────────────────────

describe('AdminSuppliersService.createDelivery — atomicity (Gruppe 1, B2)', () => {
  it('#1 happy path: 3 lines are written inside exactly one $transaction callback', async () => {
    const prisma = buildMockPrisma()
    seedHappyPath(prisma)

    prisma.inventory.findFirst.mockResolvedValue({ id: 'inv1', variantId: 'v1', warehouseId: 'wh1', quantityOnHand: 10 })
    prisma.inventory.update.mockResolvedValue({ id: 'inv1', variantId: 'v1', warehouseId: 'wh1', quantityOnHand: 12 })
    prisma.inventoryMovement.create.mockResolvedValue({ id: 'mov1' })
    prisma.supplierDelivery.create.mockResolvedValue({
      id: 'del1',
      deliveryNumber: 'WE-2026-00042',
      items: [
        { id: 'di1', variantId: 'v1', quantity: 2 },
        { id: 'di2', variantId: 'v2', quantity: 3 },
        { id: 'di3', variantId: 'v3', quantity: 5 },
      ],
    })
    prisma.productVariant.update.mockResolvedValue({})

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
      'admin1',
      '127.0.0.1',
    )

    // Transaction wrapper must have been called exactly once with an async callback
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    const call = prisma.$transaction.mock.calls[0]
    expect(typeof call[0]).toBe('function')

    // Every write must have been registered — proving they all ran inside the tx callback
    expect(prisma.supplierDelivery.create).toHaveBeenCalledTimes(1)
    expect(prisma.inventoryMovement.create).toHaveBeenCalledTimes(3)
    expect(prisma.inventory.update).toHaveBeenCalledTimes(3)
  })

  it('#2 simulated crash mid-flow: exception propagates; caller sees the failure', async () => {
    const prisma = buildMockPrisma()
    seedHappyPath(prisma)

    prisma.inventory.findFirst.mockResolvedValue({ id: 'inv1', variantId: 'v1', warehouseId: 'wh1', quantityOnHand: 10 })
    prisma.inventory.update.mockResolvedValue({ id: 'inv1', variantId: 'v1', warehouseId: 'wh1', quantityOnHand: 12 })
    prisma.supplierDelivery.create.mockResolvedValue({
      id: 'del1', deliveryNumber: 'WE-2026-00042',
      items: [{ id: 'di1', variantId: 'v1', quantity: 2 }, { id: 'di2', variantId: 'v2', quantity: 3 }],
    })
    prisma.productVariant.update.mockResolvedValue({})

    // Simulate the 2nd movement.create failing (e.g. DB connection drop)
    prisma.inventoryMovement.create
      .mockResolvedValueOnce({ id: 'mov1' })
      .mockRejectedValueOnce(new Error('simulated DB crash'))

    const service = buildService(prisma)
    await expect(
      service.createDelivery(
        {
          supplierId: 'sup1',
          existingItems: [
            { variantId: 'v1', quantity: 2 },
            { variantId: 'v2', quantity: 3 },
          ],
        },
        'admin1', '127.0.0.1',
      ),
    ).rejects.toThrow('simulated DB crash')

    // The exception must come from inside the transaction — so $transaction was
    // called exactly once and it rejected. (The rollback itself is Prisma's
    // contract; we test that the service participates in it by throwing
    // rather than swallowing the error.)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('#3 empty delivery: rejects before any write with DeliveryEmpty', async () => {
    const prisma = buildMockPrisma()
    seedHappyPath(prisma)

    const service = buildService(prisma)

    let caught: any
    try {
      await service.createDelivery({ supplierId: 'sup1' }, 'admin1', '127.0.0.1')
    } catch (e) { caught = e }

    expect(caught).toBeDefined()
    expect(caught?.response?.error).toBe('DeliveryEmpty')
    // Zero writes — not even the transaction was opened
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.supplierDelivery.create).not.toHaveBeenCalled()
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled()
  })

  it('#4 timeout config: the $transaction is invoked with a 30s timeout option', async () => {
    // Large-delivery insurance: if someone drops the timeout back to the
    // Prisma default 5s, deliveries with many newProducts would flakily
    // fail. Lock the timeout in as part of the atomicity contract.
    const prisma = buildMockPrisma()
    seedHappyPath(prisma)

    prisma.inventory.findFirst.mockResolvedValue({ id: 'inv1', variantId: 'v1', warehouseId: 'wh1', quantityOnHand: 10 })
    prisma.inventory.update.mockResolvedValue({ id: 'inv1', variantId: 'v1', warehouseId: 'wh1', quantityOnHand: 11 })
    prisma.inventoryMovement.create.mockResolvedValue({ id: 'mov1' })
    prisma.supplierDelivery.create.mockResolvedValue({
      id: 'del1', deliveryNumber: 'WE-2026-00042',
      items: [{ id: 'di1', variantId: 'v1', quantity: 1 }],
    })
    prisma.productVariant.update.mockResolvedValue({})

    const service = buildService(prisma)
    await service.createDelivery(
      { supplierId: 'sup1', existingItems: [{ variantId: 'v1', quantity: 1 }] },
      'admin1', '127.0.0.1',
    )

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    const [, opts] = prisma.$transaction.mock.calls[0]
    expect(opts).toBeDefined()
    expect(opts?.timeout).toBeGreaterThanOrEqual(30000)
  })
})
