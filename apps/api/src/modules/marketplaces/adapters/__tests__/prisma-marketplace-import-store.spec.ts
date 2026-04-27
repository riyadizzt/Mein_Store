/**
 * PrismaMarketplaceImportStore unit tests.
 *
 * The store was added in C10 as a generic Prisma-backed implementation
 * of the MarketplaceImportStore port. It's the single source of
 * idempotency for the marketplace order-import flow (C12+) and is
 * shared between EBAY (Phase 2) and TIKTOK (Phase 3). Tests pin down:
 *
 *   - claim() happy-path (fresh insert → 'claimed')
 *   - claim() dedup-path (P2002 → 'already_exists' with existing row details)
 *   - claim() defensive branches (P2002 + null follow-up → re-throw)
 *   - markImported() lifecycle (status flip + orderId + importedAt)
 *   - markFailed() lifecycle + 500-char error truncation
 *   - Marketplace-agnosticism (EBAY and TIKTOK both pass through)
 *
 * Production code is NOT touched — these tests are pure additions.
 */

import { Prisma } from '@prisma/client'
import { PrismaMarketplaceImportStore } from '../prisma-marketplace-import-store'

type AnyJest = jest.Mock<any, any>

// Minimal PrismaService mock — only the surface this store touches.
function buildPrisma() {
  return {
    marketplaceOrderImport: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  } as any
}

function buildStore(prisma: any): PrismaMarketplaceImportStore {
  return new PrismaMarketplaceImportStore(prisma)
}

// Helper: build a P2002 error matching what Prisma throws on the
// @@unique([marketplace, external_order_id]) constraint.
function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
    meta: { target: ['marketplace', 'external_order_id'] },
  })
}

// ──────────────────────────────────────────────────────────────
// claim() — happy path
// ──────────────────────────────────────────────────────────────

describe('PrismaMarketplaceImportStore.claim — happy path', () => {
  it('inserts a new row and returns claimed', async () => {
    const prisma = buildPrisma()
    ;(prisma.marketplaceOrderImport.create as AnyJest).mockResolvedValue({ id: 'imp-1' })
    const store = buildStore(prisma)

    const result = await store.claim('EBAY', 'EX-123', 'evt-1')

    expect(result).toEqual({ outcome: 'claimed', importId: 'imp-1' })
    expect(prisma.marketplaceOrderImport.create).toHaveBeenCalledWith({
      data: {
        marketplace: 'EBAY',
        externalOrderId: 'EX-123',
        rawEventId: 'evt-1',
        status: 'IMPORTING',
      },
      select: { id: true },
    })
    expect(prisma.marketplaceOrderImport.findUnique).not.toHaveBeenCalled()
  })

  it('coerces undefined rawEventId to null in the create payload', async () => {
    const prisma = buildPrisma()
    ;(prisma.marketplaceOrderImport.create as AnyJest).mockResolvedValue({ id: 'imp-2' })
    const store = buildStore(prisma)

    await store.claim('EBAY', 'EX-456')

    const call = (prisma.marketplaceOrderImport.create as AnyJest).mock.calls[0][0]
    expect(call.data.rawEventId).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────
// claim() — already_exists path (P2002 → fetch + return)
// ──────────────────────────────────────────────────────────────

describe('PrismaMarketplaceImportStore.claim — already_exists path', () => {
  it('returns already_exists with existing row details on P2002', async () => {
    const prisma = buildPrisma()
    ;(prisma.marketplaceOrderImport.create as AnyJest).mockRejectedValue(p2002())
    ;(prisma.marketplaceOrderImport.findUnique as AnyJest).mockResolvedValue({
      id: 'imp-existing',
      orderId: 'ORD-77',
      status: 'IMPORTED',
    })
    const store = buildStore(prisma)

    const result = await store.claim('EBAY', 'EX-DUP', 'evt-9')

    expect(result).toEqual({
      outcome: 'already_exists',
      importId: 'imp-existing',
      existingOrderId: 'ORD-77',
      existingStatus: 'IMPORTED',
    })
    expect(prisma.marketplaceOrderImport.findUnique).toHaveBeenCalledWith({
      where: {
        marketplace_external_order_unique: {
          marketplace: 'EBAY',
          externalOrderId: 'EX-DUP',
        },
      },
      select: { id: true, orderId: true, status: true },
    })
  })

  it('propagates null orderId when existing row has no linked order', async () => {
    const prisma = buildPrisma()
    ;(prisma.marketplaceOrderImport.create as AnyJest).mockRejectedValue(p2002())
    ;(prisma.marketplaceOrderImport.findUnique as AnyJest).mockResolvedValue({
      id: 'imp-x',
      orderId: null,
      status: 'IMPORTING',
    })
    const store = buildStore(prisma)

    const result = await store.claim('EBAY', 'EX-DUP')
    expect(result.outcome).toBe('already_exists')
    if (result.outcome === 'already_exists') {
      expect(result.existingOrderId).toBeNull()
      expect(result.existingStatus).toBe('IMPORTING')
    }
  })

  it('propagates FAILED existing-status as-is', async () => {
    const prisma = buildPrisma()
    ;(prisma.marketplaceOrderImport.create as AnyJest).mockRejectedValue(p2002())
    ;(prisma.marketplaceOrderImport.findUnique as AnyJest).mockResolvedValue({
      id: 'imp-y',
      orderId: null,
      status: 'FAILED',
    })
    const store = buildStore(prisma)

    const result = await store.claim('EBAY', 'EX-FAIL')
    if (result.outcome === 'already_exists') {
      expect(result.existingStatus).toBe('FAILED')
    }
  })
})

// ──────────────────────────────────────────────────────────────
// claim() — defensive branches
// ──────────────────────────────────────────────────────────────

describe('PrismaMarketplaceImportStore.claim — defensive branches', () => {
  it('re-throws original P2002 when follow-up findUnique returns null', async () => {
    // Race-condition: row inserted-then-deleted between P2002 and findUnique.
    // Should not silently pretend a claim succeeded — the caller has to see
    // the real failure.
    const prisma = buildPrisma()
    const originalErr = p2002()
    ;(prisma.marketplaceOrderImport.create as AnyJest).mockRejectedValue(originalErr)
    ;(prisma.marketplaceOrderImport.findUnique as AnyJest).mockResolvedValue(null)
    const store = buildStore(prisma)

    await expect(store.claim('EBAY', 'EX-RACE')).rejects.toBe(originalErr)
  })

  it('re-throws non-P2002 Prisma errors unchanged', async () => {
    const prisma = buildPrisma()
    const otherErr = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '5.22.0',
    })
    ;(prisma.marketplaceOrderImport.create as AnyJest).mockRejectedValue(otherErr)
    const store = buildStore(prisma)

    await expect(store.claim('EBAY', 'EX-???')).rejects.toBe(otherErr)
    expect(prisma.marketplaceOrderImport.findUnique).not.toHaveBeenCalled()
  })

  it('re-throws plain Error (non-Prisma) unchanged', async () => {
    const prisma = buildPrisma()
    const netErr = new Error('connection lost')
    ;(prisma.marketplaceOrderImport.create as AnyJest).mockRejectedValue(netErr)
    const store = buildStore(prisma)

    await expect(store.claim('EBAY', 'EX-NET')).rejects.toBe(netErr)
  })
})

// ──────────────────────────────────────────────────────────────
// claim() — marketplace agnosticism
// ──────────────────────────────────────────────────────────────

describe('PrismaMarketplaceImportStore.claim — marketplace agnosticism', () => {
  it('works for TIKTOK marketplace identical to EBAY', async () => {
    const prisma = buildPrisma()
    ;(prisma.marketplaceOrderImport.create as AnyJest).mockResolvedValue({ id: 'imp-tt-1' })
    const store = buildStore(prisma)

    const result = await store.claim('TIKTOK', 'TT-EX-1')

    expect(result).toEqual({ outcome: 'claimed', importId: 'imp-tt-1' })
    const call = (prisma.marketplaceOrderImport.create as AnyJest).mock.calls[0][0]
    expect(call.data.marketplace).toBe('TIKTOK')
  })
})

// ──────────────────────────────────────────────────────────────
// markImported()
// ──────────────────────────────────────────────────────────────

describe('PrismaMarketplaceImportStore.markImported', () => {
  it('flips status to IMPORTED, links orderId, sets importedAt', async () => {
    const prisma = buildPrisma()
    ;(prisma.marketplaceOrderImport.update as AnyJest).mockResolvedValue({})
    const store = buildStore(prisma)

    const before = Date.now()
    await store.markImported('imp-1', 'ORD-99', { buyerUsername: 'eBayer42' })
    const after = Date.now()

    const call = (prisma.marketplaceOrderImport.update as AnyJest).mock.calls[0][0]
    expect(call.where).toEqual({ id: 'imp-1' })
    expect(call.data.status).toBe('IMPORTED')
    expect(call.data.orderId).toBe('ORD-99')
    expect(call.data.importedAt).toBeInstanceOf(Date)
    expect(call.data.importedAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(call.data.importedAt.getTime()).toBeLessThanOrEqual(after)
    expect(call.data.metadata).toEqual({ buyerUsername: 'eBayer42' })
  })

  it('passes metadata as undefined when caller omits it (Prisma no-op)', async () => {
    const prisma = buildPrisma()
    ;(prisma.marketplaceOrderImport.update as AnyJest).mockResolvedValue({})
    const store = buildStore(prisma)

    await store.markImported('imp-2', 'ORD-100')

    const call = (prisma.marketplaceOrderImport.update as AnyJest).mock.calls[0][0]
    expect(call.data.metadata).toBeUndefined()
  })
})

// ──────────────────────────────────────────────────────────────
// markFailed()
// ──────────────────────────────────────────────────────────────

describe('PrismaMarketplaceImportStore.markFailed', () => {
  it('flips status to FAILED, persists short error verbatim', async () => {
    const prisma = buildPrisma()
    ;(prisma.marketplaceOrderImport.update as AnyJest).mockResolvedValue({})
    const store = buildStore(prisma)

    await store.markFailed('imp-3', 'mapping: SKU not found', { errorKind: 'mapping' })

    const call = (prisma.marketplaceOrderImport.update as AnyJest).mock.calls[0][0]
    expect(call.where).toEqual({ id: 'imp-3' })
    expect(call.data.status).toBe('FAILED')
    expect(call.data.error).toBe('mapping: SKU not found')
    expect(call.data.metadata).toEqual({ errorKind: 'mapping' })
  })

  it('truncates error to 500 characters', async () => {
    const prisma = buildPrisma()
    ;(prisma.marketplaceOrderImport.update as AnyJest).mockResolvedValue({})
    const store = buildStore(prisma)

    const huge = 'X'.repeat(600)
    await store.markFailed('imp-4', huge)

    const call = (prisma.marketplaceOrderImport.update as AnyJest).mock.calls[0][0]
    expect(call.data.error).toHaveLength(500)
    expect(call.data.error).toBe('X'.repeat(500))
  })

  it('passes metadata as undefined when caller omits it', async () => {
    const prisma = buildPrisma()
    ;(prisma.marketplaceOrderImport.update as AnyJest).mockResolvedValue({})
    const store = buildStore(prisma)

    await store.markFailed('imp-5', 'short')

    const call = (prisma.marketplaceOrderImport.update as AnyJest).mock.calls[0][0]
    expect(call.data.metadata).toBeUndefined()
  })
})
