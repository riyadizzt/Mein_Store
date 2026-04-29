/**
 * MarketplaceImportService (C12.4 Glue) unit tests.
 *
 * The Glue service composes:
 *   - C12.1 PrismaMarketplaceImportStore (idempotency)
 *   - C12.2 EbayOrderAdapter (mapping)
 *   - C12.3 OrdersService.createFromMarketplace (Order/Payment/History)
 * into one end-to-end import flow.
 *
 * These tests pin down the orchestration semantics:
 *   - Pass-through of skipped / failed flow outcomes
 *   - Happy path: imports, links order, fires audit
 *   - DuplicateOrderException → markImported(linked) + skipped (Klärung 1 Option B)
 *   - DuplicateOrderException + post-throw lookup fail → markFailed
 *   - Generic createFromMarketplace error → markFailed with truncated message
 *   - Audit row written exactly once on imported
 *
 * The flow itself is C9-tested separately. We mock the flow result
 * directly via mocking the inner helpers, NOT by re-running it.
 * Mock-pattern mirrors the prisma-marketplace-import-store.spec.ts.
 */

import { MarketplaceImportService } from '../marketplace-import.service'
import { DuplicateOrderException } from '../../orders/exceptions/duplicate-order.exception'
import type { MarketplaceImportEvent, MarketplaceBuyer, MarketplaceOrderDraft } from '../core/types'

type AnyJest = jest.Mock<any, any>

// ──────────────────────────────────────────────────────────────
// Mock dependency builder
// ──────────────────────────────────────────────────────────────

function buildDeps() {
  const ebayAdapter = {
    extractExternalId: jest.fn(),
    resolveBuyer: jest.fn(),
    mapToOrderDraft: jest.fn(),
  }
  const store = {
    claim: jest.fn(),
    markImported: jest.fn(),
    markFailed: jest.fn(),
  }
  const audit = { log: jest.fn().mockResolvedValue(undefined) }
  const notify = { notifyAdmins: jest.fn().mockResolvedValue(undefined) }
  const ordersService = { createFromMarketplace: jest.fn() }
  const prisma = {
    order: { findFirst: jest.fn() },
  }
  return { ebayAdapter, store, audit, notify, ordersService, prisma }
}

function buildService(d: ReturnType<typeof buildDeps>) {
  return new MarketplaceImportService(
    d.ebayAdapter as any,
    d.store as any,
    d.audit as any,
    d.notify as any,
    d.ordersService as any,
    d.prisma as any,
  )
}

function buildEvent(overrides: Partial<MarketplaceImportEvent> = {}): MarketplaceImportEvent {
  return {
    marketplace: 'EBAY',
    externalOrderId: 'EX-1',
    rawEventId: 'evt-abc',
    rawEventPayload: { orderId: 'EX-1' },
    source: 'webhook',
    ...overrides,
  }
}

function buildBuyer(overrides: Partial<MarketplaceBuyer> = {}): MarketplaceBuyer {
  return {
    email: 'ebay-buyer@marketplace.local',
    isSynthetic: true,
    externalBuyerRef: 'buyer42',
    locale: 'de',
    ...overrides,
  }
}

function buildDraft(overrides: Partial<MarketplaceOrderDraft> = {}): MarketplaceOrderDraft {
  return {
    lines: [
      {
        variantId: 'v-1',
        externalSkuRef: 'SKU-1',
        quantity: 1,
        unitPriceGross: '29.99',
        snapshotName: 'Test',
      },
    ],
    shippingAddress: {
      firstName: 'A',
      lastName: 'B',
      street: 'Strasse',
      houseNumber: '1',
      postalCode: '10115',
      city: 'Berlin',
      country: 'DE',
    },
    subtotalGross: '29.99',
    shippingCostGross: '0.00',
    totalGross: '29.99',
    currency: 'EUR',
    ...overrides,
  }
}

// ──────────────────────────────────────────────────────────────
// happy path: imported
// ──────────────────────────────────────────────────────────────

describe('MarketplaceImportService.processMarketplaceOrderEvent — imported', () => {
  it('runs flow → createFromMarketplace → markImported → audit; returns imported outcome', async () => {
    const d = buildDeps()
    // Flow internals: claim → claimed, then resolveBuyer + mapToOrderDraft succeed.
    ;(d.ebayAdapter.extractExternalId as AnyJest).mockResolvedValue('EX-1')
    ;(d.store.claim as AnyJest).mockResolvedValue({ outcome: 'claimed', importId: 'imp-1' })
    const buyer = buildBuyer()
    const draft = buildDraft()
    ;(d.ebayAdapter.resolveBuyer as AnyJest).mockResolvedValue(buyer)
    ;(d.ebayAdapter.mapToOrderDraft as AnyJest).mockResolvedValue(draft)
    ;(d.ordersService.createFromMarketplace as AnyJest).mockResolvedValue({
      id: 'order-uuid-1',
      orderNumber: 'ORD-MP-000001',
    })

    const svc = buildService(d)
    const event = buildEvent()
    const result = await svc.processMarketplaceOrderEvent(event)

    expect(result).toEqual({
      status: 'imported',
      importId: 'imp-1',
      orderId: 'order-uuid-1',
      orderNumber: 'ORD-MP-000001',
    })

    // OrdersService called with full draft + buyer + correct args
    expect(d.ordersService.createFromMarketplace).toHaveBeenCalledTimes(1)
    expect(d.ordersService.createFromMarketplace).toHaveBeenCalledWith(
      draft,
      buyer,
      'EBAY',
      'EX-1',
      'evt-abc',
    )

    // Lifecycle: markImported called with metadata
    expect(d.store.markImported).toHaveBeenCalledWith(
      'imp-1',
      'order-uuid-1',
      expect.objectContaining({
        externalOrderId: 'EX-1',
        orderNumber: 'ORD-MP-000001',
        buyerExternalRef: 'buyer42',
      }),
    )

    // Audit fires exactly once with IMPORTED action
    expect(d.audit.log).toHaveBeenCalledTimes(1)
    expect(d.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MARKETPLACE_ORDER_IMPORTED',
        entityType: 'order',
        entityId: 'order-uuid-1',
        changes: expect.objectContaining({
          marketplace: 'EBAY',
          externalOrderId: 'EX-1',
          orderNumber: 'ORD-MP-000001',
        }),
      }),
    )

    // No fallback to lookup or markFailed
    expect(d.prisma.order.findFirst).not.toHaveBeenCalled()
    expect(d.store.markFailed).not.toHaveBeenCalled()
  })

  it('falls back to corr-${Date.now()} when rawEventId is missing', async () => {
    const d = buildDeps()
    ;(d.ebayAdapter.extractExternalId as AnyJest).mockResolvedValue('EX-2')
    ;(d.store.claim as AnyJest).mockResolvedValue({ outcome: 'claimed', importId: 'imp-2' })
    ;(d.ebayAdapter.resolveBuyer as AnyJest).mockResolvedValue(buildBuyer())
    ;(d.ebayAdapter.mapToOrderDraft as AnyJest).mockResolvedValue(buildDraft())
    ;(d.ordersService.createFromMarketplace as AnyJest).mockResolvedValue({
      id: 'o2',
      orderNumber: 'N2',
    })

    const svc = buildService(d)
    await svc.processMarketplaceOrderEvent(buildEvent({ rawEventId: undefined }))

    const correlationId = (d.ordersService.createFromMarketplace as AnyJest).mock.calls[0][4]
    expect(correlationId).toMatch(/^corr-\d+$/)
  })
})

// ──────────────────────────────────────────────────────────────
// skipped — flow returns already_exists
// ──────────────────────────────────────────────────────────────

describe('MarketplaceImportService.processMarketplaceOrderEvent — skipped', () => {
  it('passes flow skipped through and never calls OrdersService', async () => {
    const d = buildDeps()
    ;(d.ebayAdapter.extractExternalId as AnyJest).mockResolvedValue('EX-3')
    ;(d.store.claim as AnyJest).mockResolvedValue({
      outcome: 'already_exists',
      importId: 'imp-existing',
      existingOrderId: 'ord-existing',
      existingStatus: 'IMPORTED',
    })

    const svc = buildService(d)
    const result = await svc.processMarketplaceOrderEvent(buildEvent({ externalOrderId: 'EX-3' }))

    expect(result).toEqual({
      status: 'skipped',
      importId: 'imp-existing',
      reason: 'already_exists',
      existingOrderId: 'ord-existing',
    })
    expect(d.ordersService.createFromMarketplace).not.toHaveBeenCalled()
    expect(d.store.markImported).not.toHaveBeenCalled()
    expect(d.store.markFailed).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────
// failed — flow returns mapping error
// ──────────────────────────────────────────────────────────────

describe('MarketplaceImportService.processMarketplaceOrderEvent — failed (flow)', () => {
  it('passes flow failure through and never calls OrdersService', async () => {
    const d = buildDeps()
    ;(d.ebayAdapter.extractExternalId as AnyJest).mockResolvedValue('EX-4')
    ;(d.store.claim as AnyJest).mockResolvedValue({ outcome: 'claimed', importId: 'imp-4' })
    ;(d.ebayAdapter.resolveBuyer as AnyJest).mockResolvedValue(buildBuyer())
    // Mapping throws → flow records FAILED via store.markFailed
    const { MappingError } = await import('../core/errors')
    ;(d.ebayAdapter.mapToOrderDraft as AnyJest).mockRejectedValue(
      new MappingError("SKU 'X' not found in product_variants"),
    )

    const svc = buildService(d)
    const result = await svc.processMarketplaceOrderEvent(buildEvent({ externalOrderId: 'EX-4' }))

    expect(result.status).toBe('failed')
    if (result.status === 'failed') {
      expect(result.errorKind).toBe('mapping')
      expect(result.reason).toContain('SKU')
    }
    expect(d.ordersService.createFromMarketplace).not.toHaveBeenCalled()
    // Flow itself wrote markFailed; glue layer did not.
    expect(d.store.markFailed).toHaveBeenCalledTimes(1)
  })
})

// ──────────────────────────────────────────────────────────────
// DuplicateOrderException — Klärung 1 Option B
// ──────────────────────────────────────────────────────────────

describe('MarketplaceImportService — DuplicateOrderException recovery (Klärung 1 Option B)', () => {
  it('looks up existing order, links via markImported, returns skipped', async () => {
    const d = buildDeps()
    ;(d.ebayAdapter.extractExternalId as AnyJest).mockResolvedValue('EX-5')
    ;(d.store.claim as AnyJest).mockResolvedValue({ outcome: 'claimed', importId: 'imp-5' })
    ;(d.ebayAdapter.resolveBuyer as AnyJest).mockResolvedValue(buildBuyer())
    ;(d.ebayAdapter.mapToOrderDraft as AnyJest).mockResolvedValue(buildDraft())
    ;(d.ordersService.createFromMarketplace as AnyJest).mockRejectedValue(
      new DuplicateOrderException('EX-5'),
    )
    ;(d.prisma.order.findFirst as AnyJest).mockResolvedValue({
      id: 'order-already-existing',
      orderNumber: 'ORD-DUP-001',
    })

    const svc = buildService(d)
    const result = await svc.processMarketplaceOrderEvent(buildEvent({ externalOrderId: 'EX-5' }))

    expect(result).toEqual({
      status: 'skipped',
      importId: 'imp-5',
      reason: 'already_exists',
      existingOrderId: 'order-already-existing',
    })

    // Lookup query: channel + channelOrderId + deletedAt:null
    expect(d.prisma.order.findFirst).toHaveBeenCalledWith({
      where: { channel: 'ebay', channelOrderId: 'EX-5', deletedAt: null },
      select: { id: true, orderNumber: true },
    })
    // markImported with linkedFromDuplicate flag
    expect(d.store.markImported).toHaveBeenCalledWith(
      'imp-5',
      'order-already-existing',
      expect.objectContaining({
        externalOrderId: 'EX-5',
        orderNumber: 'ORD-DUP-001',
        linkedFromDuplicate: true,
      }),
    )
    expect(d.store.markFailed).not.toHaveBeenCalled()
  })

  it('falls back to markFailed when the existing-order lookup returns nothing', async () => {
    const d = buildDeps()
    ;(d.ebayAdapter.extractExternalId as AnyJest).mockResolvedValue('EX-6')
    ;(d.store.claim as AnyJest).mockResolvedValue({ outcome: 'claimed', importId: 'imp-6' })
    ;(d.ebayAdapter.resolveBuyer as AnyJest).mockResolvedValue(buildBuyer())
    ;(d.ebayAdapter.mapToOrderDraft as AnyJest).mockResolvedValue(buildDraft())
    ;(d.ordersService.createFromMarketplace as AnyJest).mockRejectedValue(
      new DuplicateOrderException('EX-6'),
    )
    ;(d.prisma.order.findFirst as AnyJest).mockResolvedValue(null)

    const svc = buildService(d)
    const result = await svc.processMarketplaceOrderEvent(buildEvent({ externalOrderId: 'EX-6' }))

    expect(result.status).toBe('failed')
    if (result.status === 'failed') {
      expect(result.reason).toBe('duplicate_order_lookup_failed')
      expect(result.errorKind).toBe('unknown')
    }
    expect(d.store.markFailed).toHaveBeenCalledWith(
      'imp-6',
      'duplicate_order_lookup_failed',
      expect.objectContaining({ externalOrderId: 'EX-6' }),
    )
    expect(d.store.markImported).not.toHaveBeenCalled()
  })

  it('falls back to markFailed when the lookup itself throws', async () => {
    const d = buildDeps()
    ;(d.ebayAdapter.extractExternalId as AnyJest).mockResolvedValue('EX-7')
    ;(d.store.claim as AnyJest).mockResolvedValue({ outcome: 'claimed', importId: 'imp-7' })
    ;(d.ebayAdapter.resolveBuyer as AnyJest).mockResolvedValue(buildBuyer())
    ;(d.ebayAdapter.mapToOrderDraft as AnyJest).mockResolvedValue(buildDraft())
    ;(d.ordersService.createFromMarketplace as AnyJest).mockRejectedValue(
      new DuplicateOrderException('EX-7'),
    )
    ;(d.prisma.order.findFirst as AnyJest).mockRejectedValue(new Error('DB unreachable'))

    const svc = buildService(d)
    const result = await svc.processMarketplaceOrderEvent(buildEvent({ externalOrderId: 'EX-7' }))

    expect(result.status).toBe('failed')
    if (result.status === 'failed') {
      expect(result.reason).toBe('duplicate_order_lookup_failed')
    }
    expect(d.store.markFailed).toHaveBeenCalledWith(
      'imp-7',
      'duplicate_order_lookup_failed',
      expect.any(Object),
    )
  })
})

// ──────────────────────────────────────────────────────────────
// Generic createFromMarketplace error
// ──────────────────────────────────────────────────────────────

describe('MarketplaceImportService — generic createFromMarketplace error', () => {
  it('truncates the message, calls markFailed, returns failed unknown', async () => {
    const d = buildDeps()
    ;(d.ebayAdapter.extractExternalId as AnyJest).mockResolvedValue('EX-8')
    ;(d.store.claim as AnyJest).mockResolvedValue({ outcome: 'claimed', importId: 'imp-8' })
    ;(d.ebayAdapter.resolveBuyer as AnyJest).mockResolvedValue(buildBuyer())
    ;(d.ebayAdapter.mapToOrderDraft as AnyJest).mockResolvedValue(buildDraft())
    const long = 'X'.repeat(800)
    ;(d.ordersService.createFromMarketplace as AnyJest).mockRejectedValue(new Error(long))

    const svc = buildService(d)
    const result = await svc.processMarketplaceOrderEvent(buildEvent({ externalOrderId: 'EX-8' }))

    expect(result.status).toBe('failed')
    if (result.status === 'failed') {
      expect(result.errorKind).toBe('unknown')
      expect(result.reason.length).toBeLessThanOrEqual(500)
      expect(result.importId).toBe('imp-8')
    }
    expect(d.store.markFailed).toHaveBeenCalledWith(
      'imp-8',
      expect.any(String),
      expect.objectContaining({ errorKind: 'unknown' }),
    )
    expect(d.store.markImported).not.toHaveBeenCalled()
    expect(d.audit.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MARKETPLACE_ORDER_IMPORTED' }),
    )
  })
})
