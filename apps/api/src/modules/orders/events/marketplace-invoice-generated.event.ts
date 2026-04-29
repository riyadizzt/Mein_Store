/**
 * Event emitted by MarketplaceInvoiceListener AFTER an invoice PDF has
 * been generated and stored for a marketplace order (C13.1).
 *
 * Distinct from `invoice.generated` (used by shop orders) so that
 * InvoiceEmailListener does NOT trigger an email send to the buyer's
 * synthetic `<token>@marketplace.local` proxy address.
 *
 * Today (C13.1) NO listener consumes this event — it's a future-proof
 * hook for:
 *   - C13.2: uploadOrderInvoice push to eBay (so buyer sees PDF in
 *     eBay's Order Details page)
 *   - admin bell-notification "Marketplace invoice generated" (later
 *     iteration if observability needed)
 *   - audit-log entry
 *
 * The listener emits this AFTER `marketplace.order.imported` has been
 * processed. Failure to emit is non-fatal for the order import — the
 * invoice creation itself is also try/catch wrapped.
 */

export const MARKETPLACE_INVOICE_EVENTS = {
  GENERATED: 'marketplace.invoice.generated',
} as const

export class MarketplaceInvoiceGeneratedEvent {
  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly invoiceNumber: string,
    public readonly grossAmount: string,
    public readonly pdfBuffer: Buffer,
    public readonly marketplace: 'EBAY' | 'TIKTOK',
    public readonly externalOrderId: string,
    public readonly correlationId: string,
  ) {}
}
