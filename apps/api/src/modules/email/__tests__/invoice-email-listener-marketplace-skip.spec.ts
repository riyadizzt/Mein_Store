/**
 * Regression-anchor for the C13.1 architectural decision:
 *
 *   InvoiceEmailListener listens to event-name 'invoice.generated'
 *   ONLY. The marketplace flow uses 'marketplace.invoice.generated'
 *   so it does NOT trigger this listener and thus does NOT email
 *   the buyer's synthetic <token>@marketplace.local proxy address.
 *
 * If a future refactor accidentally renames either constant or unifies
 * them, these tests fail loudly — preventing a Resend-reputation
 * incident from a black-hole-bouncing email.
 *
 * Tests:
 *   1. Decorator metadata: @OnEvent value is 'invoice.generated'
 *   2. Constants do NOT match: MARKETPLACE_INVOICE_EVENTS.GENERATED
 *      is a different string than the legacy event name
 *   3. The listener IS still wired for the legacy event (regression
 *      anchor — we don't want to accidentally remove the shop-order
 *      email path)
 */

import 'reflect-metadata'
import { InvoiceEmailListener } from '../listeners/invoice-email.listener'
import { MARKETPLACE_INVOICE_EVENTS } from '../../orders/events/marketplace-invoice-generated.event'

const LEGACY_INVOICE_EVENT = 'invoice.generated'
const MARKETPLACE_EVENT = MARKETPLACE_INVOICE_EVENTS.GENERATED

// ──────────────────────────────────────────────────────────────
// Constant-name divergence
// ──────────────────────────────────────────────────────────────

describe('Event-name divergence: shop vs marketplace invoices (C13.1)', () => {
  it('marketplace event name differs from the shop event name', () => {
    expect(MARKETPLACE_EVENT).toBe('marketplace.invoice.generated')
    expect(LEGACY_INVOICE_EVENT).toBe('invoice.generated')
    expect(MARKETPLACE_EVENT).not.toBe(LEGACY_INVOICE_EVENT)
  })

  it('marketplace event name has the namespacing prefix that prevents listener overlap', () => {
    expect(MARKETPLACE_EVENT.startsWith('marketplace.')).toBe(true)
    expect(LEGACY_INVOICE_EVENT.startsWith('marketplace.')).toBe(false)
  })
})

// ──────────────────────────────────────────────────────────────
// InvoiceEmailListener decorator-metadata pin-down
// ──────────────────────────────────────────────────────────────

describe('InvoiceEmailListener decorator metadata', () => {
  // NestJS @OnEvent stores the event-name in metadata under a specific
  // key. We read it via Reflect.getMetadata to verify the listener IS
  // wired for the legacy event and ONLY that event.
  function getOnEventMetadata(target: any, methodName: string): string[] {
    // @nestjs/event-emitter uses 'EVENT_LISTENER_METADATA' (string key)
    // for storing decorator config. Each handler can have multiple
    // events; we look at all of them.
    const proto = target.prototype
    const meta = Reflect.getMetadata('EVENT_LISTENER_METADATA', proto[methodName])
    if (Array.isArray(meta)) return meta.map((m: any) => m.event)
    if (meta && typeof meta === 'object') return [meta.event]
    return []
  }

  it('handleInvoiceGenerated is decorated with the legacy event-name', () => {
    const events = getOnEventMetadata(InvoiceEmailListener, 'handleInvoiceGenerated')
    // Should contain the legacy shop-order event so existing flow is intact
    expect(events).toContain(LEGACY_INVOICE_EVENT)
  })

  it('handleInvoiceGenerated is NOT decorated with the marketplace event-name', () => {
    const events = getOnEventMetadata(InvoiceEmailListener, 'handleInvoiceGenerated')
    // CRITICAL: must NOT listen to marketplace.invoice.generated, otherwise
    // the synthetic buyer email proxy would be emailed.
    expect(events).not.toContain(MARKETPLACE_EVENT)
  })
})
