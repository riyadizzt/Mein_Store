/**
 * C9 — Adapter interface contract checks.
 *
 * These tests lock the three adapter interfaces in place: any
 * future refactor that silently changes a method name / signature
 * will fail here. The tests are structural — they don't execute
 * real marketplace calls, they compile-check that a minimal
 * conformant fake satisfies each interface.
 */

import type {
  IListingPublisher,
  IOrderImporter,
  IReturnImporter,
  MarketplaceReturnEvent,
} from '../adapter.interfaces'
import type {
  MarketplaceImportEvent,
  MarketplaceOrderDraft,
  MarketplaceBuyer,
  MarketplaceImportStore,
  MarketplaceAuditPort,
  MarketplaceNotificationPort,
} from '../types'
import { MappingError, DuplicateImportError, InsufficientStockForMarketplaceOrderError, MarketplaceError } from '../errors'

describe('C9 — adapter interface contracts', () => {
  it('IListingPublisher has publish/unpublish/updatePrice/updateQuantity', () => {
    const fake: IListingPublisher = {
      async publish(input) {
        expect(input.variantId).toBeDefined()
        return { externalListingId: 'ext-1' }
      },
      async unpublish(id) { expect(typeof id).toBe('string') },
      async updatePrice(_id, price) { expect(typeof price).toBe('string') },
      async updateQuantity(_id, qty) { expect(typeof qty).toBe('number') },
    }
    expect(typeof fake.publish).toBe('function')
    expect(typeof fake.unpublish).toBe('function')
    expect(typeof fake.updatePrice).toBe('function')
    expect(typeof fake.updateQuantity).toBe('function')
  })

  it('IOrderImporter has the three ordered hook-callbacks', () => {
    const fake: IOrderImporter = {
      extractExternalId(e) { return e.externalOrderId },
      async resolveBuyer(_e): Promise<MarketplaceBuyer> {
        return { email: 'x@marketplace.local', isSynthetic: true, externalBuyerRef: 'buyer-1' }
      },
      async mapToOrderDraft(_e, _buyer): Promise<MarketplaceOrderDraft> {
        return {
          lines: [],
          shippingAddress: {
            firstName: 'A', lastName: 'B', street: 'C', houseNumber: '1',
            postalCode: '12345', city: 'Berlin', country: 'DE',
          },
          subtotalGross: '0.00', shippingCostGross: '0.00', totalGross: '0.00',
          currency: 'EUR',
        }
      },
    }
    expect(typeof fake.extractExternalId).toBe('function')
    expect(typeof fake.resolveBuyer).toBe('function')
    expect(typeof fake.mapToOrderDraft).toBe('function')
  })

  it('IReturnImporter has extractExternalReturnId + mapToReturnRequest', () => {
    const fake: IReturnImporter = {
      extractExternalReturnId(e) { return e.externalReturnId },
      async mapToReturnRequest(_e) { return {} },
    }
    expect(typeof fake.extractExternalReturnId).toBe('function')
    expect(typeof fake.mapToReturnRequest).toBe('function')
  })

  it('MarketplaceImportStore port has claim + markImported + markFailed', () => {
    const fake: MarketplaceImportStore = {
      async claim(_m, _id) { return { outcome: 'claimed', importId: 'imp-1' } },
      async markImported(_id, _orderId) {},
      async markFailed(_id, _err) {},
    }
    expect(typeof fake.claim).toBe('function')
    expect(typeof fake.markImported).toBe('function')
    expect(typeof fake.markFailed).toBe('function')
  })

  it('MarketplaceAuditPort.log is a function', () => {
    const fake: MarketplaceAuditPort = { async log(_e) {} }
    expect(typeof fake.log).toBe('function')
  })

  it('MarketplaceNotificationPort.notifyAdmins is a function', () => {
    const fake: MarketplaceNotificationPort = { async notifyAdmins(_e) {} }
    expect(typeof fake.notifyAdmins).toBe('function')
  })

  it('Error classes all extend MarketplaceError with instanceof', () => {
    const mapErr = new MappingError('x')
    const dupErr = new DuplicateImportError('ext-1')
    const stockErr = new InsufficientStockForMarketplaceOrderError('ext-1', [])
    expect(mapErr).toBeInstanceOf(MarketplaceError)
    expect(dupErr).toBeInstanceOf(MarketplaceError)
    expect(stockErr).toBeInstanceOf(MarketplaceError)
    // Preserve distinct names so audit-log can differentiate.
    expect(mapErr.name).toBe('MappingError')
    expect(dupErr.name).toBe('DuplicateImportError')
    expect(stockErr.name).toBe('InsufficientStockForMarketplaceOrderError')
  })

  it('MarketplaceImportEvent shape is marketplace-agnostic', () => {
    // This test enforces the naming hygiene rule (user
    // requirement): only external* fields for marketplace-sourced
    // IDs. If someone adds an ebay-specific / tiktok-specific
    // field the shape check would need to be updated — we assert
    // the key-set explicitly.
    const evt: MarketplaceImportEvent = {
      marketplace: 'EBAY',
      externalOrderId: '12-34567',
      rawEventPayload: {},
      source: 'webhook',
    }
    const keys = Object.keys(evt).sort()
    expect(keys).toEqual(['externalOrderId', 'marketplace', 'rawEventPayload', 'source'])
    // rawEventId is optional — not in the minimal instance.
  })

  it('MarketplaceReturnEvent uses localOrderId (not orderId) for clarity', () => {
    const evt: MarketplaceReturnEvent = {
      marketplace: 'TIKTOK',
      localOrderId: 'uuid-of-local-order',
      externalReturnId: 'RET-ext-1',
      rawEventPayload: {},
    }
    expect(evt.localOrderId).toBeDefined()
    // Deliberate: localOrderId is our own, externalReturnId is theirs.
    expect((evt as any).orderId).toBeUndefined()
    expect((evt as any).ebayReturnId).toBeUndefined()
    expect((evt as any).tiktokReturnId).toBeUndefined()
  })
})
