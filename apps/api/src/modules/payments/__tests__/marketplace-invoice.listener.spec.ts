/**
 * MarketplaceInvoiceListener (C13.1) unit tests.
 *
 * Pins down the C13.1 contract:
 *   - Listener fires on `marketplace.order.imported` events
 *   - Calls InvoiceService.generateAndStoreInvoice with orderId
 *   - Emits `marketplace.invoice.generated` with full payload
 *   - Idempotent: re-importing same order does not re-fire
 *     (delegated to InvoiceService — listener trusts existing-row return)
 *   - Failure swallowed: invoice generation throw does NOT bubble
 *     → order-import success path is unaffected
 *   - Pass-through: marketplace + externalOrderId + correlationId
 *     fields propagate to MarketplaceInvoiceGeneratedEvent
 */

import { MarketplaceInvoiceListener } from '../listeners/marketplace-invoice.listener'
import {
  MarketplaceOrderImportedEvent,
  MARKETPLACE_ORDER_EVENTS,
} from '../../orders/events/marketplace-order-imported.event'
import { MARKETPLACE_INVOICE_EVENTS } from '../../orders/events/marketplace-invoice-generated.event'

type AnyJest = jest.Mock<any, any>

function buildDeps() {
  const invoiceService = {
    generateAndStoreInvoice: jest.fn(),
  }
  const eventEmitter = {
    emit: jest.fn(),
  }
  return { invoiceService, eventEmitter }
}

function buildListener(d: ReturnType<typeof buildDeps>) {
  return new MarketplaceInvoiceListener(d.invoiceService as any, d.eventEmitter as any)
}

function buildEvent(
  overrides: Partial<MarketplaceOrderImportedEvent> = {},
): MarketplaceOrderImportedEvent {
  return new MarketplaceOrderImportedEvent(
    overrides.orderId ?? 'order-uuid-1',
    overrides.orderNumber ?? 'ORD-MP-001',
    overrides.marketplace ?? 'EBAY',
    overrides.externalOrderId ?? '12-12345-67890',
    overrides.correlationId ?? 'evt-correlation-abc',
    overrides.items ?? [
      {
        variantId: 'v-1',
        warehouseId: 'wh-marzahn',
        quantity: 1,
        reservationSessionId: 'res-1',
      },
    ],
  )
}

// ──────────────────────────────────────────────────────────────
// Happy path
// ──────────────────────────────────────────────────────────────

describe('MarketplaceInvoiceListener.handleOrderImported — happy path', () => {
  it('generates invoice and emits marketplace.invoice.generated', async () => {
    const d = buildDeps()
    ;(d.invoiceService.generateAndStoreInvoice as AnyJest).mockResolvedValue({
      invoice: {
        invoiceNumber: 'RE-2026-00042',
        grossAmount: '64.89',
      },
      pdfBuffer: Buffer.from('PDF-CONTENT'),
    })

    const listener = buildListener(d)
    const event = buildEvent()
    await listener.handleOrderImported(event)

    expect(d.invoiceService.generateAndStoreInvoice).toHaveBeenCalledWith('order-uuid-1')
    expect(d.eventEmitter.emit).toHaveBeenCalledTimes(1)
    expect(d.eventEmitter.emit).toHaveBeenCalledWith(
      MARKETPLACE_INVOICE_EVENTS.GENERATED,
      expect.objectContaining({
        orderId: 'order-uuid-1',
        orderNumber: 'ORD-MP-001',
        invoiceNumber: 'RE-2026-00042',
        grossAmount: '64.89',
        marketplace: 'EBAY',
        externalOrderId: '12-12345-67890',
        correlationId: 'evt-correlation-abc',
      }),
    )
    const emitted = (d.eventEmitter.emit as AnyJest).mock.calls[0][1]
    expect(emitted.pdfBuffer).toBeInstanceOf(Buffer)
    expect(emitted.pdfBuffer.toString()).toBe('PDF-CONTENT')
  })

  it('formats grossAmount to 2 decimals from numeric input', async () => {
    const d = buildDeps()
    // generateAndStoreInvoice returns grossAmount as Decimal/number variant
    ;(d.invoiceService.generateAndStoreInvoice as AnyJest).mockResolvedValue({
      invoice: { invoiceNumber: 'RE-2026-00043', grossAmount: 100 },
      pdfBuffer: Buffer.alloc(0),
    })

    const listener = buildListener(d)
    await listener.handleOrderImported(buildEvent())

    const emitted = (d.eventEmitter.emit as AnyJest).mock.calls[0][1]
    expect(emitted.grossAmount).toBe('100.00')
  })
})

// ──────────────────────────────────────────────────────────────
// Idempotency (InvoiceService handles it; listener just trusts)
// ──────────────────────────────────────────────────────────────

describe('MarketplaceInvoiceListener — idempotency', () => {
  it('passes through whatever InvoiceService returns (existing or new)', async () => {
    const d = buildDeps()
    // Simulate InvoiceService finding an existing invoice from a prior run
    ;(d.invoiceService.generateAndStoreInvoice as AnyJest).mockResolvedValue({
      invoice: {
        id: 'inv-existing',
        invoiceNumber: 'RE-2026-00041',
        grossAmount: '49.99',
      },
      pdfBuffer: Buffer.from('CACHED-PDF'),
    })

    const listener = buildListener(d)
    await listener.handleOrderImported(buildEvent())

    expect(d.invoiceService.generateAndStoreInvoice).toHaveBeenCalledTimes(1)
    expect(d.eventEmitter.emit).toHaveBeenCalledTimes(1)
    const emitted = (d.eventEmitter.emit as AnyJest).mock.calls[0][1]
    expect(emitted.invoiceNumber).toBe('RE-2026-00041')
  })
})

// ──────────────────────────────────────────────────────────────
// Failure swallowing
// ──────────────────────────────────────────────────────────────

describe('MarketplaceInvoiceListener — error handling', () => {
  it('swallows InvoiceService.generateAndStoreInvoice failures', async () => {
    const d = buildDeps()
    ;(d.invoiceService.generateAndStoreInvoice as AnyJest).mockRejectedValue(
      new Error('Storage upload failed: 503'),
    )

    const listener = buildListener(d)
    // Must NOT throw
    await expect(listener.handleOrderImported(buildEvent())).resolves.toBeUndefined()

    expect(d.invoiceService.generateAndStoreInvoice).toHaveBeenCalledTimes(1)
    // Event NOT emitted on failure path
    expect(d.eventEmitter.emit).not.toHaveBeenCalled()
  })

  it('swallows non-Error thrown values too (defensive)', async () => {
    const d = buildDeps()
    ;(d.invoiceService.generateAndStoreInvoice as AnyJest).mockRejectedValue('plain string error')

    const listener = buildListener(d)
    await expect(listener.handleOrderImported(buildEvent())).resolves.toBeUndefined()
    expect(d.eventEmitter.emit).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────
// Marketplace pass-through (TIKTOK ready for Phase 3)
// ──────────────────────────────────────────────────────────────

describe('MarketplaceInvoiceListener — marketplace pass-through', () => {
  it('forwards TIKTOK marketplace identifier in the emitted event', async () => {
    const d = buildDeps()
    ;(d.invoiceService.generateAndStoreInvoice as AnyJest).mockResolvedValue({
      invoice: { invoiceNumber: 'RE-2026-00050', grossAmount: '19.90' },
      pdfBuffer: Buffer.alloc(0),
    })

    const listener = buildListener(d)
    await listener.handleOrderImported(buildEvent({ marketplace: 'TIKTOK' }))

    const emitted = (d.eventEmitter.emit as AnyJest).mock.calls[0][1]
    expect(emitted.marketplace).toBe('TIKTOK')
  })

  it('listens to MARKETPLACE_ORDER_EVENTS.IMPORTED constant (regression-anchor)', () => {
    expect(MARKETPLACE_ORDER_EVENTS.IMPORTED).toBe('marketplace.order.imported')
    expect(MARKETPLACE_INVOICE_EVENTS.GENERATED).toBe('marketplace.invoice.generated')
    // Critical: the two constants must NEVER converge — that would
    // re-trigger InvoiceEmailListener and email the synthetic buyer.
    expect(MARKETPLACE_ORDER_EVENTS.IMPORTED).not.toBe(MARKETPLACE_INVOICE_EVENTS.GENERATED)
    // And neither must equal the legacy shop-event 'invoice.generated'
    expect(MARKETPLACE_INVOICE_EVENTS.GENERATED).not.toBe('invoice.generated')
  })
})
