/**
 * Data-integrity regression for processReturnScan (Gruppe 3, B8).
 *
 * The scanner endpoint restocks items listed in return.returnItems. If
 * that JSON has been manipulated (DB edit, rogue admin script, future
 * bug in the return-acceptance flow) to include variantIds that do NOT
 * belong to the parent order, the pre-Gruppe-3 loop would cheerfully
 * increment those foreign variants' stock — a quiet data-integrity leak.
 *
 * Post-hardening: before the restock loop runs, every resolved variantId
 * must appear in ret.order.items. A single mismatch rejects the whole
 * scan (all-or-nothing), writes a structured 400 response, and records
 * an audit-log entry RETURN_SCAN_REJECTED_FOREIGN_VARIANT for forensics.
 *
 * Meta-verifiable: removing the foreign-variant check lets the loop
 * process the rogue row and onHand.increment fires — tests #1 and #2
 * both detect this.
 */

import { BadRequestException } from '@nestjs/common'
import { AdminInventoryService } from '../services/admin-inventory.service'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJest = jest.Mock<any, any>

function buildPrisma() {
  const mock: any = {
    return: { findFirst: jest.fn(), update: jest.fn() },
    inventory: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    inventoryMovement: { create: jest.fn() },
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

function baseReturn(opts: {
  orderVariantIds: string[]
  returnItems: Array<{ variantId?: string; itemId?: string; quantity?: number; sku?: string }>
}) {
  return {
    id: 'ret1',
    returnNumber: 'RET-2026-00001',
    status: 'in_transit',
    returnItems: opts.returnItems,
    order: {
      id: 'order1',
      orderNumber: 'ORD-20260421-000001',
      items: opts.orderVariantIds.map((vid, i) => ({
        id: `oi-${i}`,
        variantId: vid,
        snapshotName: `Item ${vid}`,
        snapshotSku: `SKU-${vid}`,
        quantity: 1,
      })),
    },
  }
}

describe('processReturnScan — foreign-variant guard (Gruppe 3, B8)', () => {
  it('#1 returnItems with a variantId not in order.items → 400 + no restock + audit', async () => {
    const prisma = buildPrisma()
    ;(prisma.return.findFirst as AnyJest).mockResolvedValue(
      baseReturn({
        orderVariantIds: ['v-legit-1', 'v-legit-2'],
        returnItems: [
          { variantId: 'v-legit-1', quantity: 2, sku: 'SKU-v-legit-1' },
          { variantId: 'v-FOREIGN', quantity: 5, sku: 'SKU-v-FOREIGN' },  // not in order
        ],
      }),
    )

    const service = buildService(prisma)

    let caught: any
    try {
      await service.processReturnScan('RET-2026-00001', 'admin1', 'wh1')
    } catch (e) { caught = e }

    expect(caught).toBeInstanceOf(BadRequestException)
    expect(caught.response?.error).toBe('ReturnScanForeignVariant')
    expect(caught.response?.data?.foreignItems).toEqual([
      { variantId: 'v-FOREIGN', source: 'SKU-v-FOREIGN' },
    ])
    expect(caught.response?.data?.allowedVariantCount).toBe(2)
    // Multi-lang message surface
    expect(caught.response?.message?.de).toContain('nicht zu dieser Bestellung')
    expect(caught.response?.message?.en).toContain('do not belong')
    expect(caught.response?.message?.ar).toContain('لا تنتمي')

    // All-or-nothing: NO restock writes happened, even for the legit row
    expect(prisma.inventory.update).not.toHaveBeenCalled()
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled()
    // Audit log for forensics
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'RETURN_SCAN_REJECTED_FOREIGN_VARIANT',
          entityId: 'ret1',
        }),
      }),
    )
  })

  it('#2 multiple foreign variants: all listed in the error payload', async () => {
    const prisma = buildPrisma()
    ;(prisma.return.findFirst as AnyJest).mockResolvedValue(
      baseReturn({
        orderVariantIds: ['v-A'],
        returnItems: [
          { variantId: 'v-A', quantity: 1 },
          { variantId: 'v-B', quantity: 1, sku: 'SKU-B' },
          { variantId: 'v-C', quantity: 1, sku: 'SKU-C' },
        ],
      }),
    )

    const service = buildService(prisma)

    let caught: any
    try {
      await service.processReturnScan('RET-2026-00001', 'admin1', 'wh1')
    } catch (e) { caught = e }

    expect(caught).toBeInstanceOf(BadRequestException)
    const foreigns = caught.response?.data?.foreignItems
    expect(foreigns).toHaveLength(2)
    const foreignVariantIds = foreigns.map((f: any) => f.variantId).sort()
    expect(foreignVariantIds).toEqual(['v-B', 'v-C'])
    expect(prisma.inventory.update).not.toHaveBeenCalled()
  })

  it('#3 all variantIds legitimate → scan proceeds normally, no foreign-variant audit', async () => {
    const prisma = buildPrisma()
    ;(prisma.return.findFirst as AnyJest).mockResolvedValue(
      baseReturn({
        orderVariantIds: ['v-A', 'v-B'],
        returnItems: [
          { variantId: 'v-A', quantity: 2 },
          { variantId: 'v-B', quantity: 3 },
        ],
      }),
    )
    ;(prisma.inventory.findFirst as AnyJest).mockResolvedValue({
      id: 'inv1', variantId: 'v-A', warehouseId: 'wh1', quantityOnHand: 10,
    })
    ;(prisma.inventory.update as AnyJest).mockResolvedValue({})
    ;(prisma.inventoryMovement.create as AnyJest).mockResolvedValue({})
    ;(prisma.return.update as AnyJest).mockResolvedValue({})

    const service = buildService(prisma)
    await service.processReturnScan('RET-2026-00001', 'admin1', 'wh1')

    // Normal restock path fires
    expect(prisma.inventory.update).toHaveBeenCalledTimes(2)
    expect(prisma.inventoryMovement.create).toHaveBeenCalledTimes(2)
    // No foreign-variant audit — only the regular RETURN_SCANNED entry
    const auditCalls = (prisma.adminAuditLog.create as AnyJest).mock.calls
    const actions = auditCalls.map((c: any) => c[0].data.action)
    expect(actions).not.toContain('RETURN_SCAN_REJECTED_FOREIGN_VARIANT')
  })
})
