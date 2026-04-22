/**
 * C9 — OrderImportFlow behaviour tests.
 *
 * Runs the real flow against in-memory fakes for the three ports
 * (store, audit, notify) and programmable fake adapters. No DB,
 * no DI, no NestJS.
 *
 * Meta-verify targets in this suite:
 *   MV-1  Adapter's mapToOrderDraft throwing MappingError → flow
 *         exits FAILED with errorKind='mapping' and store.markFailed
 *         is invoked exactly once.
 *   MV-2  Second run for same externalOrderId → first run returns
 *         IMPORTED, second returns SKIPPED with existingStatus,
 *         adapter's mapToOrderDraft is NOT invoked a second time.
 *   (MV-3 lives in package.json scripting — documented at bottom
 *    of this file.)
 *
 * Plus general coverage for: extract-id failure, buyer-resolve
 * failure, insufficient-stock branch, unknown-error branch,
 * audit/notify port failures that must not poison the flow.
 */

import type { Marketplace } from '@prisma/client'
import { OrderImportFlow, FLOW_AUDIT_ACTIONS } from '../order-import-flow'
import { MappingError, InsufficientStockForMarketplaceOrderError } from '../errors'
import type {
  MarketplaceImportEvent,
  MarketplaceOrderDraft,
  MarketplaceBuyer,
  MarketplaceImportStore,
  MarketplaceAuditPort,
  MarketplaceNotificationPort,
  ClaimResult,
} from '../types'
import type { IOrderImporter } from '../adapter.interfaces'

// ──────────────────────────────────────────────────────────────
// In-memory fakes
// ──────────────────────────────────────────────────────────────

class InMemoryStore implements MarketplaceImportStore {
  // key = `${marketplace}|${externalOrderId}`
  private rows = new Map<string, {
    id: string
    status: 'IMPORTING' | 'IMPORTED' | 'FAILED' | 'SKIPPED'
    orderId?: string | null
    error?: string
    metadata?: Record<string, unknown>
  }>()
  private counter = 0
  readonly claimCalls: Array<{ marketplace: Marketplace; externalOrderId: string }> = []
  readonly markImportedCalls: Array<{ importId: string; orderId: string }> = []
  readonly markFailedCalls: Array<{ importId: string; error: string }> = []

  async claim(marketplace: Marketplace, externalOrderId: string): Promise<ClaimResult> {
    this.claimCalls.push({ marketplace, externalOrderId })
    const k = `${marketplace}|${externalOrderId}`
    const existing = this.rows.get(k)
    if (existing) {
      return {
        outcome: 'already_exists',
        importId: existing.id,
        existingOrderId: existing.orderId ?? null,
        existingStatus: existing.status,
      }
    }
    const id = `imp-${++this.counter}`
    this.rows.set(k, { id, status: 'IMPORTING' })
    return { outcome: 'claimed', importId: id }
  }

  async markImported(importId: string, orderId: string, metadata?: Record<string, unknown>) {
    this.markImportedCalls.push({ importId, orderId })
    for (const row of this.rows.values()) {
      if (row.id === importId) {
        row.status = 'IMPORTED'
        row.orderId = orderId
        row.metadata = metadata
      }
    }
  }

  async markFailed(importId: string, error: string, metadata?: Record<string, unknown>) {
    this.markFailedCalls.push({ importId, error })
    for (const row of this.rows.values()) {
      if (row.id === importId) {
        row.status = 'FAILED'
        row.error = error
        row.metadata = metadata
      }
    }
  }
}

class RecordingAudit implements MarketplaceAuditPort {
  readonly entries: Array<Parameters<MarketplaceAuditPort['log']>[0]> = []
  shouldThrow = false
  async log(entry: Parameters<MarketplaceAuditPort['log']>[0]) {
    if (this.shouldThrow) throw new Error('audit down')
    this.entries.push(entry)
  }
}

class RecordingNotify implements MarketplaceNotificationPort {
  readonly events: Array<Parameters<MarketplaceNotificationPort['notifyAdmins']>[0]> = []
  shouldThrow = false
  async notifyAdmins(event: Parameters<MarketplaceNotificationPort['notifyAdmins']>[0]) {
    if (this.shouldThrow) throw new Error('notify down')
    this.events.push(event)
  }
}

function validDraft(): MarketplaceOrderDraft {
  return {
    lines: [
      { variantId: 'variant-uuid-1', externalSkuRef: 'SKU-1', quantity: 1, unitPriceGross: '49.99' },
    ],
    shippingAddress: {
      firstName: 'Buyer', lastName: 'Test', street: 'Pannierstr.', houseNumber: '4',
      postalCode: '12047', city: 'Berlin', country: 'DE',
    },
    subtotalGross: '49.99',
    shippingCostGross: '4.99',
    totalGross: '54.98',
    currency: 'EUR',
  }
}

function validBuyer(): MarketplaceBuyer {
  return {
    email: 'ebay-buyer-abc@marketplace.local',
    isSynthetic: true,
    externalBuyerRef: 'ebay-buyer-abc',
    firstName: 'Buyer',
    lastName: 'Test',
    locale: 'de',
  }
}

function buildEvent(overrides: Partial<MarketplaceImportEvent> = {}): MarketplaceImportEvent {
  return {
    marketplace: 'EBAY',
    externalOrderId: '12-34567-89012',
    rawEventId: 'evt-1',
    rawEventPayload: { any: 'payload' },
    source: 'webhook',
    ...overrides,
  }
}

function buildImporter(opts: {
  extractThrow?: boolean
  extractOverride?: string
  resolveBuyerThrow?: 'mapping' | 'unknown'
  mapThrow?: 'mapping' | 'insufficient_stock' | 'unknown'
} = {}): IOrderImporter {
  const calls = { extract: 0, resolveBuyer: 0, map: 0 }
  const importer = {
    _calls: calls,
    extractExternalId(e: MarketplaceImportEvent) {
      calls.extract++
      if (opts.extractThrow) throw new Error('extract boom')
      return opts.extractOverride ?? e.externalOrderId
    },
    async resolveBuyer(_e: MarketplaceImportEvent) {
      calls.resolveBuyer++
      if (opts.resolveBuyerThrow === 'mapping') throw new MappingError('buyer missing')
      if (opts.resolveBuyerThrow === 'unknown') throw new Error('unexpected resolve failure')
      return validBuyer()
    },
    async mapToOrderDraft(_e: MarketplaceImportEvent, _b: MarketplaceBuyer) {
      calls.map++
      if (opts.mapThrow === 'mapping') throw new MappingError('sku unresolvable: SKU-X')
      if (opts.mapThrow === 'insufficient_stock') {
        throw new InsufficientStockForMarketplaceOrderError('12-34567-89012', [
          { externalSkuRef: 'SKU-1', requested: 3, available: 1 },
        ])
      }
      if (opts.mapThrow === 'unknown') throw new Error('unexpected map failure')
      return validDraft()
    },
  }
  return importer as unknown as IOrderImporter
}

// ──────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────

describe('OrderImportFlow — happy path', () => {
  it('imports a fresh event and returns status=imported with the draft', async () => {
    const store = new InMemoryStore()
    const audit = new RecordingAudit()
    const notify = new RecordingNotify()
    const importer = buildImporter()
    const flow = new OrderImportFlow({ importer, store, audit, notify })

    const result = await flow.run(buildEvent())

    expect(result.status).toBe('imported')
    if (result.status === 'imported') {
      expect(result.externalOrderId).toBe('12-34567-89012')
      expect(result.marketplace).toBe('EBAY')
      expect(result.importId).toBe('imp-1')
      expect(result.draft.lines).toHaveLength(1)
    }

    // Claim was made once; markImported and markFailed were NOT
    // called by the flow itself (caller does markImported in C12).
    expect(store.claimCalls).toHaveLength(1)
    expect(store.markImportedCalls).toHaveLength(0)
    expect(store.markFailedCalls).toHaveLength(0)

    // Flow deliberately does NOT emit an IMPORTED audit on its
    // own; the caller does after OrdersService confirms.
    expect(audit.entries).toHaveLength(0)
    expect(notify.events).toHaveLength(0)
  })
})

describe('OrderImportFlow — MV-2 duplicate event → SKIPPED', () => {
  it('second run for same externalOrderId skips without invoking mapToOrderDraft again', async () => {
    const store = new InMemoryStore()
    const audit = new RecordingAudit()
    const notify = new RecordingNotify()
    const importer = buildImporter()
    const flow = new OrderImportFlow({ importer, store, audit, notify })

    // First run: seed a successful import. The flow by itself does
    // not mark it IMPORTED — the caller does. Simulate that here
    // before the second run to exercise the SKIPPED branch with a
    // realistic existing-row state.
    const first = await flow.run(buildEvent())
    expect(first.status).toBe('imported')
    if (first.status === 'imported') {
      await store.markImported(first.importId, 'order-local-1')
    }

    const secondImporter = buildImporter()
    const flow2 = new OrderImportFlow({ importer: secondImporter, store, audit, notify })

    const second = await flow2.run(buildEvent())

    expect(second.status).toBe('skipped')
    if (second.status === 'skipped') {
      expect(second.externalOrderId).toBe('12-34567-89012')
      expect(second.existingOrderId).toBe('order-local-1')
      expect(second.existingStatus).toBe('IMPORTED')
    }

    // Proves the flow short-circuits: mapToOrderDraft was not called
    // on the second pass.
    expect((secondImporter as any)._calls.map).toBe(0)
    // SKIPPED audit was recorded.
    const skipped = audit.entries.find((e) => e.action === FLOW_AUDIT_ACTIONS.SKIPPED)
    expect(skipped).toBeDefined()
    expect(skipped?.entityType).toBe('marketplace_order_import')
  })
})

describe('OrderImportFlow — MV-1 MappingError from mapToOrderDraft', () => {
  it('transitions import to FAILED with errorKind=mapping and audits the failure', async () => {
    const store = new InMemoryStore()
    const audit = new RecordingAudit()
    const notify = new RecordingNotify()
    const importer = buildImporter({ mapThrow: 'mapping' })
    const flow = new OrderImportFlow({ importer, store, audit, notify })

    const result = await flow.run(buildEvent())

    expect(result.status).toBe('failed')
    if (result.status === 'failed') {
      expect(result.errorKind).toBe('mapping')
      expect(result.error).toContain('sku unresolvable')
    }
    expect(store.markFailedCalls).toHaveLength(1)
    expect(store.markImportedCalls).toHaveLength(0)
    const failed = audit.entries.find((e) => e.action === FLOW_AUDIT_ACTIONS.FAILED)
    expect(failed).toBeDefined()
    expect((failed?.changes as any)?.errorKind).toBe('mapping')
  })

  it('MappingError from resolveBuyer also lands as errorKind=mapping', async () => {
    const store = new InMemoryStore()
    const audit = new RecordingAudit()
    const notify = new RecordingNotify()
    const importer = buildImporter({ resolveBuyerThrow: 'mapping' })
    const flow = new OrderImportFlow({ importer, store, audit, notify })

    const result = await flow.run(buildEvent())

    expect(result.status).toBe('failed')
    if (result.status === 'failed') expect(result.errorKind).toBe('mapping')
    expect(store.markFailedCalls).toHaveLength(1)
    // Important: buyer-step failure must NOT have invoked
    // mapToOrderDraft.
    expect((importer as any)._calls.map).toBe(0)
  })
})

describe('OrderImportFlow — insufficient-stock branch', () => {
  it('marks import FAILED with errorKind=insufficient_stock and notifies admins', async () => {
    const store = new InMemoryStore()
    const audit = new RecordingAudit()
    const notify = new RecordingNotify()
    const importer = buildImporter({ mapThrow: 'insufficient_stock' })
    const flow = new OrderImportFlow({ importer, store, audit, notify })

    const result = await flow.run(buildEvent())

    expect(result.status).toBe('failed')
    if (result.status === 'failed') expect(result.errorKind).toBe('insufficient_stock')
    expect(notify.events).toHaveLength(1)
    expect(notify.events[0].type).toBe('marketplace_oversell_alert')
    expect((notify.events[0].data as any).offendingLines).toEqual([
      { externalSkuRef: 'SKU-1', requested: 3, available: 1 },
    ])
  })
})

describe('OrderImportFlow — unknown-error branches', () => {
  it('extract-id failure returns failed with errorKind=unknown and does NOT claim', async () => {
    const store = new InMemoryStore()
    const audit = new RecordingAudit()
    const notify = new RecordingNotify()
    const importer = buildImporter({ extractThrow: true })
    const flow = new OrderImportFlow({ importer, store, audit, notify })

    const result = await flow.run(buildEvent())

    expect(result.status).toBe('failed')
    if (result.status === 'failed') {
      expect(result.errorKind).toBe('unknown')
      expect(result.error).toContain('extract-external-id failed')
    }
    // No claim was attempted — no importId to persist yet.
    expect(store.claimCalls).toHaveLength(0)
  })

  it('unknown error inside mapToOrderDraft still marks the import FAILED', async () => {
    const store = new InMemoryStore()
    const audit = new RecordingAudit()
    const notify = new RecordingNotify()
    const importer = buildImporter({ mapThrow: 'unknown' })
    const flow = new OrderImportFlow({ importer, store, audit, notify })

    const result = await flow.run(buildEvent())

    expect(result.status).toBe('failed')
    if (result.status === 'failed') expect(result.errorKind).toBe('unknown')
    expect(store.markFailedCalls).toHaveLength(1)
  })
})

describe('OrderImportFlow — audit/notify failures do not poison the flow', () => {
  it('audit.log throwing on happy path does not affect the returned outcome', async () => {
    const store = new InMemoryStore()
    const audit = new RecordingAudit()
    audit.shouldThrow = true
    const notify = new RecordingNotify()
    const importer = buildImporter()
    const flow = new OrderImportFlow({ importer, store, audit, notify })

    const result = await flow.run(buildEvent())
    // Happy path emits no audit, so this particular test primarily
    // proves the method shape — but we chain a skip-case below to
    // cover the throw branch.
    expect(result.status).toBe('imported')
  })

  it('audit.log throwing during a SKIPPED path still returns status=skipped', async () => {
    const store = new InMemoryStore()
    const audit = new RecordingAudit()
    const notify = new RecordingNotify()
    const importer = buildImporter()
    const flow1 = new OrderImportFlow({ importer, store, audit, notify })
    const first = await flow1.run(buildEvent())
    if (first.status === 'imported') await store.markImported(first.importId, 'order-1')

    audit.shouldThrow = true
    const flow2 = new OrderImportFlow({ importer: buildImporter(), store, audit, notify })
    const second = await flow2.run(buildEvent())
    expect(second.status).toBe('skipped')
  })

  it('notify failure during insufficient-stock branch still returns status=failed', async () => {
    const store = new InMemoryStore()
    const audit = new RecordingAudit()
    const notify = new RecordingNotify()
    notify.shouldThrow = true
    const importer = buildImporter({ mapThrow: 'insufficient_stock' })
    const flow = new OrderImportFlow({ importer, store, audit, notify })

    const result = await flow.run(buildEvent())
    expect(result.status).toBe('failed')
    if (result.status === 'failed') expect(result.errorKind).toBe('insufficient_stock')
    expect(store.markFailedCalls).toHaveLength(1)
  })
})

describe('OrderImportFlow — marketplace agnosticism', () => {
  it('accepts a TIKTOK event and produces the same outcome shape', async () => {
    const store = new InMemoryStore()
    const audit = new RecordingAudit()
    const notify = new RecordingNotify()
    const importer = buildImporter()
    const flow = new OrderImportFlow({ importer, store, audit, notify })

    const result = await flow.run(buildEvent({ marketplace: 'TIKTOK', externalOrderId: 'tt-999' }))
    expect(result.status).toBe('imported')
    if (result.status === 'imported') {
      expect(result.marketplace).toBe('TIKTOK')
    }
    // Claim key is scoped by marketplace — so EBAY vs TIKTOK with
    // the same externalOrderId do NOT collide. Prove it:
    const flow2 = new OrderImportFlow({ importer: buildImporter(), store, audit, notify })
    const result2 = await flow2.run(buildEvent({ marketplace: 'EBAY', externalOrderId: 'tt-999' }))
    expect(result2.status).toBe('imported')
  })
})

/*
──────────────────────────────────────────────────────────────
MV-3 — dedup-gate load-bearing proof
──────────────────────────────────────────────────────────────

The MV-3 meta-verify is executed out-of-band from this suite:

  1. Comment out the `if (claim.outcome === 'already_exists')` block
     in apps/api/src/modules/marketplaces/core/order-import-flow.ts
     (lines in Step 2 — idempotency gate).
  2. Re-run just this file:
       pnpm -F @omnichannel/api exec jest order-import-flow
  3. Expect: the MV-2 suite ("duplicate event → SKIPPED") fails
     because the second run proceeds to resolveBuyer / mapToOrderDraft
     instead of short-circuiting.
  4. Restore the guard, re-run — all green.

This proves the guard is load-bearing and that MV-2 is specifically
testing it.
*/
