/**
 * Input-dedup regression for processReturnScan (Gruppe 3, B9).
 *
 * If ret.returnItems JSON contains two entries referencing the same
 * variantId (UI bug where the form renders a duplicate row, manual
 * edit, or repeated scanner reads), the pre-Gruppe-3 loop treated each
 * as a separate restock and incremented onHand twice.
 *
 * Post-hardening: a pre-processing pass groups entries by variantId and
 * sums their quantities, so the restock loop sees exactly one logical
 * work-item per variant. When a dedup collapse happens, an audit-log
 * entry RETURN_SCAN_INPUT_DEDUPLICATED records it for forensics.
 *
 * Meta-verifiable: reverting the dedup step lets two rows with qty=1
 * each produce two separate inventory.update + inventoryMovement.create
 * calls — test #1 catches this shape change.
 */

import { AdminInventoryService } from '../services/admin-inventory.service'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJest = jest.Mock<any, any>

function buildPrisma() {
  const mock: any = {
    return: { findFirst: jest.fn(), update: jest.fn() },
    inventory: {
      findFirst: jest.fn().mockResolvedValue({ id: 'inv1', variantId: 'v-A', warehouseId: 'wh1', quantityOnHand: 10 }),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn(),
    },
    inventoryMovement: { create: jest.fn().mockResolvedValue({}) },
    adminAuditLog: { create: jest.fn().mockResolvedValue({}) },
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

function returnWithVariants(
  orderVariantIds: string[],
  returnItems: Array<{ variantId?: string; quantity?: number }>,
) {
  return {
    id: 'ret1',
    returnNumber: 'RET-2026-00001',
    status: 'in_transit',
    returnItems,
    order: {
      id: 'order1',
      orderNumber: 'ORD-20260421-000001',
      items: orderVariantIds.map((vid, i) => ({
        id: `oi-${i}`,
        variantId: vid,
        snapshotName: `Item ${vid}`,
        snapshotSku: `SKU-${vid}`,
        quantity: 5,
      })),
    },
  }
}

describe('processReturnScan — input deduplication (Gruppe 3, B9)', () => {
  it('#1 two entries for same variantId with qty=1 → one restock of qty=2', async () => {
    const prisma = buildPrisma()
    ;(prisma.return.findFirst as AnyJest).mockResolvedValue(
      returnWithVariants(['v-A'], [
        { variantId: 'v-A', quantity: 1 },
        { variantId: 'v-A', quantity: 1 },  // duplicate
      ]),
    )
    ;(prisma.return.update as AnyJest).mockResolvedValue({})

    const service = buildService(prisma)
    const result = await service.processReturnScan('RET-2026-00001', 'admin1', 'wh1')

    // Exactly ONE inventory.update call, summing both dup rows (1 + 1 = 2)
    expect(prisma.inventory.update).toHaveBeenCalledTimes(1)
    const updateArgs = (prisma.inventory.update as AnyJest).mock.calls[0][0]
    expect(updateArgs.data).toEqual({ quantityOnHand: { increment: 2 } })

    // Exactly ONE movement row, quantity = 2
    expect(prisma.inventoryMovement.create).toHaveBeenCalledTimes(1)
    const movArgs = (prisma.inventoryMovement.create as AnyJest).mock.calls[0][0].data
    expect(movArgs.quantity).toBe(2)

    // Audit: RETURN_SCAN_INPUT_DEDUPLICATED entry logged the collapse
    const auditCalls = (prisma.adminAuditLog.create as AnyJest).mock.calls
    const dedupEntry = auditCalls.find((c: any) => c[0].data.action === 'RETURN_SCAN_INPUT_DEDUPLICATED')
    expect(dedupEntry).toBeDefined()
    expect(dedupEntry[0].data.changes.inputRowCount).toBe(2)
    expect(dedupEntry[0].data.changes.uniqueVariants).toBe(1)
    expect(dedupEntry[0].data.changes.collapsedRows).toBe(1)

    // User-facing response: "1 item restocked" (one logical item, not two)
    expect(result.itemsRestocked).toBe(1)
  })

  it('#2 three entries with qtys [2, 3, 1] for same variant → one restock of qty=6', async () => {
    const prisma = buildPrisma()
    ;(prisma.return.findFirst as AnyJest).mockResolvedValue(
      returnWithVariants(['v-A'], [
        { variantId: 'v-A', quantity: 2 },
        { variantId: 'v-A', quantity: 3 },
        { variantId: 'v-A', quantity: 1 },
      ]),
    )
    ;(prisma.return.update as AnyJest).mockResolvedValue({})

    const service = buildService(prisma)
    await service.processReturnScan('RET-2026-00001', 'admin1', 'wh1')

    expect(prisma.inventory.update).toHaveBeenCalledTimes(1)
    const updateArgs = (prisma.inventory.update as AnyJest).mock.calls[0][0]
    expect(updateArgs.data).toEqual({ quantityOnHand: { increment: 6 } })

    const movArgs = (prisma.inventoryMovement.create as AnyJest).mock.calls[0][0].data
    expect(movArgs.quantity).toBe(6)
  })

  it('#3 no duplicates → dedup is a no-op, no dedup audit fires', async () => {
    const prisma = buildPrisma()
    ;(prisma.return.findFirst as AnyJest).mockResolvedValue(
      returnWithVariants(['v-A', 'v-B'], [
        { variantId: 'v-A', quantity: 2 },
        { variantId: 'v-B', quantity: 3 },
      ]),
    )
    ;(prisma.return.update as AnyJest).mockResolvedValue({})
    // Different inventory per variant lookup
    let firstFirstCall = true
    ;(prisma.inventory.findFirst as AnyJest).mockImplementation(async () => {
      if (firstFirstCall) {
        firstFirstCall = false
        return { id: 'inv-A', variantId: 'v-A', warehouseId: 'wh1', quantityOnHand: 10 }
      }
      return { id: 'inv-B', variantId: 'v-B', warehouseId: 'wh1', quantityOnHand: 20 }
    })

    const service = buildService(prisma)
    await service.processReturnScan('RET-2026-00001', 'admin1', 'wh1')

    // Two separate restock calls, quantities untouched
    expect(prisma.inventory.update).toHaveBeenCalledTimes(2)
    const updateArgs = (prisma.inventory.update as AnyJest).mock.calls.map((c: any) => c[0].data)
    expect(updateArgs).toContainEqual({ quantityOnHand: { increment: 2 } })
    expect(updateArgs).toContainEqual({ quantityOnHand: { increment: 3 } })

    // No dedup audit entry — nothing was collapsed
    const auditCalls = (prisma.adminAuditLog.create as AnyJest).mock.calls
    const actions = auditCalls.map((c: any) => c[0].data.action)
    expect(actions).not.toContain('RETURN_SCAN_INPUT_DEDUPLICATED')
  })
})
