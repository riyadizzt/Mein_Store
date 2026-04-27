/**
 * Integration-style tests for EbayOrderAdapter (C12.2).
 *
 * Mocks PrismaService.productVariant.findMany — every other path is
 * pure-helper-driven. Tests the 3 IOrderImporter hook methods:
 *   - extractExternalId (cheap, sync-style)
 *   - resolveBuyer (synthetic email, fullName split, locale=de)
 *   - mapToOrderDraft (the heart — guards, SKU lookup, totals, draft)
 */

import { EbayOrderAdapter } from '../ebay-order.adapter'
import type { MarketplaceImportEvent, MarketplaceBuyer } from '../../core/types'
import minimalFixture from './fixtures/ebay-getOrder-minimal.json'
import multiLineFixture from './fixtures/ebay-getOrder-multi-line.json'
import discountFixture from './fixtures/ebay-getOrder-discount.json'
import addressEdgeFixture from './fixtures/ebay-getOrder-address-edge.json'
import internalRedirectFixture from './fixtures/ebay-getOrder-internal-redirect.json'

type AnyJest = jest.Mock<any, any>

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x))
}

function buildPrisma() {
  return {
    productVariant: { findMany: jest.fn() },
  } as any
}

function buildAdapter(prisma: any) {
  return new EbayOrderAdapter(prisma)
}

function buildEvent(payload: any): MarketplaceImportEvent {
  return {
    marketplace: 'EBAY',
    externalOrderId: payload.orderId,
    rawEventPayload: payload,
    source: 'webhook',
  }
}

function buildBuyer(): MarketplaceBuyer {
  return {
    email: 'ebay-anna_b_de2024@marketplace.local',
    isSynthetic: true,
    externalBuyerRef: 'anna_b_de2024',
    firstName: 'Anna',
    lastName: 'Becker',
    locale: 'de',
  }
}

// ──────────────────────────────────────────────────────────────
// extractExternalId
// ──────────────────────────────────────────────────────────────

describe('EbayOrderAdapter.extractExternalId', () => {
  it('returns orderId from minimal fixture', async () => {
    const adapter = buildAdapter(buildPrisma())
    const result = await adapter.extractExternalId(buildEvent(clone(minimalFixture)))
    expect(result).toBe('13-12345-67890')
  })
})

// ──────────────────────────────────────────────────────────────
// resolveBuyer
// ──────────────────────────────────────────────────────────────

describe('EbayOrderAdapter.resolveBuyer', () => {
  it('synthesizes email format ebay-{ref}@marketplace.local', async () => {
    const adapter = buildAdapter(buildPrisma())
    const buyer = await adapter.resolveBuyer(buildEvent(clone(minimalFixture)))
    expect(buyer.email).toBe('ebay-anna_b_de2024@marketplace.local')
    expect(buyer.isSynthetic).toBe(true)
    expect(buyer.externalBuyerRef).toBe('anna_b_de2024')
  })

  it('hardcodes locale=de for EBAY_DE', async () => {
    const adapter = buildAdapter(buildPrisma())
    const buyer = await adapter.resolveBuyer(buildEvent(clone(minimalFixture)))
    expect(buyer.locale).toBe('de')
  })

  it('splits fullName into firstName/lastName', async () => {
    const adapter = buildAdapter(buildPrisma())
    const buyer = await adapter.resolveBuyer(buildEvent(clone(minimalFixture)))
    expect(buyer.firstName).toBe('Anna')
    expect(buyer.lastName).toBe('Becker')
  })
})

// ──────────────────────────────────────────────────────────────
// mapToOrderDraft — happy path
// ──────────────────────────────────────────────────────────────

describe('EbayOrderAdapter.mapToOrderDraft — happy path', () => {
  it('returns matching draft for minimal-fixture', async () => {
    const prisma = buildPrisma()
    ;(prisma.productVariant.findMany as AnyJest).mockResolvedValue([
      { id: 'variant-uuid-1', sku: 'MAL-HERREN-SCH-40' },
    ])
    const adapter = buildAdapter(prisma)
    const draft = await adapter.mapToOrderDraft(
      buildEvent(clone(minimalFixture)),
      buildBuyer(),
    )

    expect(draft.lines).toHaveLength(1)
    expect(draft.lines[0]).toEqual({
      variantId: 'variant-uuid-1',
      externalSkuRef: 'MAL-HERREN-SCH-40',
      externalListingId: '284567890123',
      quantity: 1,
      unitPriceGross: '59.90',
      snapshotName: 'Herren Schuhe Schwarz 40',
    })
    expect(draft.shippingAddress).toEqual({
      firstName: 'Anna',
      lastName: 'Becker',
      street: 'Hauptstrasse',
      houseNumber: '42',
      addressLine2: undefined,
      postalCode: '10117',
      city: 'Berlin',
      country: 'DE',
    })
    expect(draft.subtotalGross).toBe('59.90')
    expect(draft.shippingCostGross).toBe('4.99')
    expect(draft.totalGross).toBe('64.89')
    expect(draft.currency).toBe('EUR')
  })

  it('falls back to SKU as snapshotName if eBay omits title', async () => {
    const noTitle = clone(minimalFixture) as any
    delete noTitle.lineItems[0].title
    const prisma = buildPrisma()
    ;(prisma.productVariant.findMany as AnyJest).mockResolvedValue([
      { id: 'variant-uuid-1', sku: 'MAL-HERREN-SCH-40' },
    ])
    const adapter = buildAdapter(prisma)
    const draft = await adapter.mapToOrderDraft(buildEvent(noTitle), buildBuyer())
    expect(draft.lines[0].snapshotName).toBe('MAL-HERREN-SCH-40')
  })
})

// ──────────────────────────────────────────────────────────────
// mapToOrderDraft — SKU lookup
// ──────────────────────────────────────────────────────────────

describe('EbayOrderAdapter.mapToOrderDraft — SKU lookup', () => {
  it('queries prisma.productVariant.findMany with collected SKUs', async () => {
    const prisma = buildPrisma()
    ;(prisma.productVariant.findMany as AnyJest).mockResolvedValue([
      { id: 'v-1', sku: 'MAL-HERREN-SCH-40' },
      { id: 'v-2', sku: 'MAL-HERREN-WEI-42' },
    ])
    const adapter = buildAdapter(prisma)
    await adapter.mapToOrderDraft(buildEvent(clone(multiLineFixture)), buildBuyer())

    const call = (prisma.productVariant.findMany as AnyJest).mock.calls[0][0]
    expect(call.where.sku.in.sort()).toEqual([
      'MAL-HERREN-SCH-40',
      'MAL-HERREN-WEI-42',
    ])
    expect(call.where.isActive).toBe(true)
  })

  it('throws MappingError when SKU not found in DB', async () => {
    const prisma = buildPrisma()
    ;(prisma.productVariant.findMany as AnyJest).mockResolvedValue([])
    const adapter = buildAdapter(prisma)
    await expect(
      adapter.mapToOrderDraft(buildEvent(clone(minimalFixture)), buildBuyer()),
    ).rejects.toThrow(/not found in product_variants/)
  })

  it('throws MappingError when lineItem has no SKU', async () => {
    const bad = clone(minimalFixture) as any
    delete bad.lineItems[0].sku
    const adapter = buildAdapter(buildPrisma())
    await expect(
      adapter.mapToOrderDraft(buildEvent(bad), buildBuyer()),
    ).rejects.toThrow(/has no SKU/)
  })
})

// ──────────────────────────────────────────────────────────────
// mapToOrderDraft — guard rejects
// ──────────────────────────────────────────────────────────────

describe('EbayOrderAdapter.mapToOrderDraft — guard rejects', () => {
  it('throws on internal-redirect addressLine1', async () => {
    const adapter = buildAdapter(buildPrisma())
    await expect(
      adapter.mapToOrderDraft(buildEvent(clone(internalRedirectFixture)), buildBuyer()),
    ).rejects.toThrow(/eBay internal redirect/)
  })

  it('throws on countryCode != DE', async () => {
    const bad = clone(minimalFixture) as any
    bad.fulfillmentStartInstructions[0].shippingStep.shipTo.contactAddress.countryCode = 'AT'
    const adapter = buildAdapter(buildPrisma())
    await expect(
      adapter.mapToOrderDraft(buildEvent(bad), buildBuyer()),
    ).rejects.toThrow(/countryCode='AT'/)
  })
})

// ──────────────────────────────────────────────────────────────
// mapToOrderDraft — discount Math.abs
// ──────────────────────────────────────────────────────────────

describe('EbayOrderAdapter.mapToOrderDraft — discount Math.abs', () => {
  it('priceDiscount=-6.00 → notes contains "€6.00"', async () => {
    const prisma = buildPrisma()
    ;(prisma.productVariant.findMany as AnyJest).mockResolvedValue([
      { id: 'v-1', sku: 'MAL-HERREN-SCH-40' },
    ])
    const adapter = buildAdapter(prisma)
    const draft = await adapter.mapToOrderDraft(
      buildEvent(clone(discountFixture)),
      buildBuyer(),
    )
    expect(draft.notes).toContain('€6.00')
    expect(draft.notes).not.toContain('-')
  })
})

// ──────────────────────────────────────────────────────────────
// mapToOrderDraft — totals mismatch
// ──────────────────────────────────────────────────────────────

describe('EbayOrderAdapter.mapToOrderDraft — totals mismatch', () => {
  it('lineSum mismatch > 1 cent → throws MappingError', async () => {
    const bad = clone(minimalFixture) as any
    bad.lineItems[0].lineItemCost.value = '99.99'
    const prisma = buildPrisma()
    ;(prisma.productVariant.findMany as AnyJest).mockResolvedValue([
      { id: 'v-1', sku: 'MAL-HERREN-SCH-40' },
    ])
    const adapter = buildAdapter(prisma)
    await expect(
      adapter.mapToOrderDraft(buildEvent(bad), buildBuyer()),
    ).rejects.toThrow(/totals mismatch/)
  })
})

// ──────────────────────────────────────────────────────────────
// mapToOrderDraft — houseNumber fallback
// ──────────────────────────────────────────────────────────────

describe('EbayOrderAdapter.mapToOrderDraft — houseNumber fallback', () => {
  it('logger.warn called when splitDeAddress returns empty houseNumber', async () => {
    const bad = clone(minimalFixture) as any
    bad.fulfillmentStartInstructions[0].shippingStep.shipTo.contactAddress.addressLine1 = 'Im Quartier'
    const prisma = buildPrisma()
    ;(prisma.productVariant.findMany as AnyJest).mockResolvedValue([
      { id: 'v-1', sku: 'MAL-HERREN-SCH-40' },
    ])
    const adapter = buildAdapter(prisma)
    const warnSpy = jest.spyOn((adapter as any).logger, 'warn').mockImplementation(() => {})

    const draft = await adapter.mapToOrderDraft(buildEvent(bad), buildBuyer())

    expect(warnSpy).toHaveBeenCalled()
    expect(draft.shippingAddress.street).toBe('Im Quartier')
    expect(draft.shippingAddress.houseNumber).toBe('')

    warnSpy.mockRestore()
  })
})

// ──────────────────────────────────────────────────────────────
// mapToOrderDraft — multi-line + address-edge
// ──────────────────────────────────────────────────────────────

describe('EbayOrderAdapter.mapToOrderDraft — multi-line', () => {
  it('returns 2 lines for multi-line fixture', async () => {
    const prisma = buildPrisma()
    ;(prisma.productVariant.findMany as AnyJest).mockResolvedValue([
      { id: 'v-1', sku: 'MAL-HERREN-SCH-40' },
      { id: 'v-2', sku: 'MAL-HERREN-WEI-42' },
    ])
    const adapter = buildAdapter(prisma)
    const draft = await adapter.mapToOrderDraft(
      buildEvent(clone(multiLineFixture)),
      buildBuyer(),
    )
    expect(draft.lines).toHaveLength(2)
    expect(draft.lines.map((l) => l.externalSkuRef).sort()).toEqual([
      'MAL-HERREN-SCH-40',
      'MAL-HERREN-WEI-42',
    ])
  })

  it('handles range-number address ("Berliner Str. 12-14")', async () => {
    const prisma = buildPrisma()
    ;(prisma.productVariant.findMany as AnyJest).mockResolvedValue([
      { id: 'v-1', sku: 'MAL-HERREN-SCH-40' },
    ])
    const adapter = buildAdapter(prisma)
    const draft = await adapter.mapToOrderDraft(
      buildEvent(clone(addressEdgeFixture)),
      buildBuyer(),
    )
    expect(draft.shippingAddress.street).toBe('Berliner Str.')
    expect(draft.shippingAddress.houseNumber).toBe('12-14')
  })
})
