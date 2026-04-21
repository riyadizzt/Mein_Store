/**
 * C8 — Schema-contract test for Phase 2 (eBay) / Phase 3 (TikTok Shop)
 * groundwork. Runs against the compiled Prisma client, no live DB.
 *
 * Tests the Prisma-layer contract:
 *   - SalesChannel enum includes 'ebay' (+ existing 'tiktok' for Phase 3)
 *   - PaymentProvider enum includes 'EBAY_MANAGED_PAYMENTS'
 *   - Marketplace + MarketplaceImportStatus enums exported with expected values
 *   - MarketplaceOrderImport delegate exists on the client
 *
 * Database-side constraint behavior (unique-gate + partial-unique index)
 * is covered by the Live-DB smoke script: scripts/smoke-c8-constraints.ts
 */

import {
  SalesChannel,
  PaymentProvider,
  Marketplace,
  MarketplaceImportStatus,
  PrismaClient,
} from '@prisma/client'

describe('C8 — Marketplace schema contract', () => {
  it('SalesChannel enum contains ebay and tiktok', () => {
    expect(Object.values(SalesChannel)).toContain('ebay')
    expect(Object.values(SalesChannel)).toContain('tiktok')
  })

  it('SalesChannel retains all pre-C8 values (backward compat)', () => {
    const vals = Object.values(SalesChannel)
    for (const legacy of ['website', 'mobile', 'pos', 'facebook', 'instagram', 'google', 'whatsapp']) {
      expect(vals).toContain(legacy)
    }
  })

  it('PaymentProvider enum contains EBAY_MANAGED_PAYMENTS', () => {
    expect(Object.values(PaymentProvider)).toContain('EBAY_MANAGED_PAYMENTS')
  })

  it('PaymentProvider retains all pre-C8 providers (backward compat)', () => {
    const vals = Object.values(PaymentProvider)
    for (const legacy of ['STRIPE', 'KLARNA', 'PAYPAL', 'VORKASSE', 'SUMUP']) {
      expect(vals).toContain(legacy)
    }
  })

  it('Marketplace enum has EBAY and TIKTOK', () => {
    expect(Object.values(Marketplace).sort()).toEqual(['EBAY', 'TIKTOK'])
  })

  it('MarketplaceImportStatus enum has the four lifecycle states', () => {
    expect(Object.values(MarketplaceImportStatus).sort()).toEqual(
      ['FAILED', 'IMPORTED', 'IMPORTING', 'SKIPPED']
    )
  })

  it('PrismaClient exposes marketplaceOrderImport delegate', () => {
    const c = new PrismaClient()
    expect(c.marketplaceOrderImport).toBeDefined()
    // Spot-check a few methods that must exist on any Prisma model.
    expect(typeof c.marketplaceOrderImport.findFirst).toBe('function')
    expect(typeof c.marketplaceOrderImport.create).toBe('function')
    expect(typeof c.marketplaceOrderImport.update).toBe('function')
    c.$disconnect().catch(() => {})
  })
})
