/**
 * Atomic-increment regression for AdminInventoryService.intake().
 *
 * Bug B6 from the 2026-04-20 audit: pre-refactor, intake() did:
 *   const inv = await findUnique(...)
 *   const newQty = inv.quantityOnHand + item.quantity
 *   await $transaction([
 *     update({ quantityOnHand: newQty }),   // ← overwrite, not atomic add
 *     movement.create(...),
 *   ])
 * Under READ COMMITTED isolation two concurrent intakes both read the
 * same stale `quantityOnHand`, both compute the same `newQty`, both
 * write it — one increment lost.
 *
 * Post-refactor: the update uses `{ quantityOnHand: { increment: qty } }`
 * and the authoritative post-write value comes back via Prisma's
 * `select`-on-update, so quantityAfter is correct even under races.
 *
 * This spec is structural — we assert the intake path never emits an
 * overwrite-style update on quantityOnHand. Meta-verifiable: reverting
 * the service to the old overwrite pattern trips test #1 immediately.
 */

import { AdminInventoryService } from '../services/admin-inventory.service'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJest = jest.Mock<any, any>

function buildMock() {
  const mock: any = {
    inventory: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    inventoryMovement: { create: jest.fn() },
  }
  mock.$transaction = jest.fn().mockImplementation(async (arg: any) => {
    if (typeof arg === 'function') return arg(mock)
    return Promise.all(arg)
  })
  return mock
}

function buildService(prisma: any): AdminInventoryService {
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as any
  return new AdminInventoryService(prisma as any, audit)
}

describe('AdminInventoryService.intake — atomic increment (Gruppe 1, B6)', () => {
  it('#1 update uses atomic { increment } and select includes variant+warehouse+quantityOnHand', async () => {
    const prisma = buildMock()
    // Atomic update returns the authoritative post-write values
    ;(prisma.inventory.update as AnyJest).mockResolvedValue({
      variantId: 'v1',
      warehouseId: 'wh1',
      quantityOnHand: 15,  // 10 before, +5 delta
    })
    ;(prisma.inventoryMovement.create as AnyJest).mockResolvedValue({ id: 'mov1' })

    const service = buildService(prisma)
    const result = await service.intake(
      [{ inventoryId: 'inv1', quantity: 5 }],
      'purchase_order_42', 'admin1', '127.0.0.1',
    )

    expect(result.processed).toBe(1)
    expect(result.items[0]).toEqual({
      inventoryId: 'inv1',
      before: 10,
      after: 15,
      added: 5,
    })

    // The single update call must use `increment`, NOT a computed newQty
    expect(prisma.inventory.update).toHaveBeenCalledTimes(1)
    const updateArgs = (prisma.inventory.update as AnyJest).mock.calls[0][0]
    expect(updateArgs.data).toEqual({ quantityOnHand: { increment: 5 } })
    // Must select variantId + warehouseId + quantityOnHand so the movement
    // can be written with the authoritative post-write value and the webhook
    // can fire without a second DB round-trip.
    expect(updateArgs.select).toEqual(
      expect.objectContaining({
        quantityOnHand: true,
        variantId: true,
        warehouseId: true,
      }),
    )

    // Movement's quantityBefore + quantityAfter derived from the atomic
    // post-write value (not locally computed from stale read).
    const movArgs = (prisma.inventoryMovement.create as AnyJest).mock.calls[0][0].data
    expect(movArgs.quantityBefore).toBe(10)  // 15 - 5
    expect(movArgs.quantityAfter).toBe(15)
    expect(movArgs.quantity).toBe(5)
    expect(movArgs.type).toBe('purchase_received')  // reason !== 'return'
  })

  it('#2 concurrent intakes on same row: both atomic increments commit independently', async () => {
    // Simulates the exact race the old read-then-write pattern failed.
    // Two intakes for qty=3 and qty=4 on the same inventory row should
    // settle at +7 total, not +4 (stale-read loser) or +3 (other loser).
    //
    // Under Prisma's interactive transaction + atomic increment, each tx
    // sees its own post-write value. We mock this by having update return
    // different final values per call, as if two DB transactions had each
    // atomically incremented by their own delta on top of a shared base.
    const prisma = buildMock()
    let callNo = 0
    ;(prisma.inventory.update as AnyJest).mockImplementation(async () => {
      callNo++
      if (callNo === 1) return { variantId: 'v1', warehouseId: 'wh1', quantityOnHand: 13 }  // 10 + 3
      if (callNo === 2) return { variantId: 'v1', warehouseId: 'wh1', quantityOnHand: 17 }  // 13 + 4
      throw new Error('unexpected third update')
    })
    ;(prisma.inventoryMovement.create as AnyJest).mockResolvedValue({ id: 'mov' })

    const service = buildService(prisma)
    const result = await service.intake(
      [
        { inventoryId: 'inv1', quantity: 3 },
        { inventoryId: 'inv1', quantity: 4 },
      ],
      'correction', 'admin1', '127.0.0.1',
    )

    expect(result.processed).toBe(2)

    // Both items recorded with their OWN atomic after-value; no collision
    expect(result.items[0].added).toBe(3)
    expect(result.items[0].before).toBe(10)
    expect(result.items[0].after).toBe(13)

    expect(result.items[1].added).toBe(4)
    expect(result.items[1].before).toBe(13)  // the authoritative before for the 2nd atomic op
    expect(result.items[1].after).toBe(17)   // 10 + 3 + 4 — no increment lost

    // Both movements reference the correct pair of before/after
    expect((prisma.inventoryMovement.create as AnyJest)).toHaveBeenCalledTimes(2)
    const m1 = (prisma.inventoryMovement.create as AnyJest).mock.calls[0][0].data
    const m2 = (prisma.inventoryMovement.create as AnyJest).mock.calls[1][0].data
    expect([m1.quantityAfter, m2.quantityAfter]).toEqual([13, 17])
  })
})
