/**
 * MarketplaceInvoiceListener (C13.1).
 *
 * Listens to `marketplace.order.imported` (emitted by
 * OrdersService.createFromMarketplace after C12.3 atomic-tx commit) and
 * generates the invoice PDF for the just-imported marketplace order.
 *
 * Why a separate listener (not inline in createFromMarketplace):
 *   - Hard-Rule from C12.3: OrdersService constructor MUST stay
 *     unchanged (existing test mocks would break otherwise).
 *   - InvoiceService lives in PaymentsModule; injecting it into
 *     OrdersService would require a cross-module wire that we want to
 *     avoid for cycle-prevention.
 *   - The listener pattern is consistent with MarketplaceOversellListener
 *     (admin/listeners/), which also fires on a marketplace.* event.
 *
 * Why a NEW event-name `marketplace.invoice.generated` (not the existing
 * `invoice.generated`):
 *   - Existing InvoiceEmailListener listens to `invoice.generated` and
 *     would dispatch a customer email to the buyer's synthetic
 *     `<token>@marketplace.local` proxy address — a black hole that
 *     would also pollute our Resend reputation.
 *   - With a different event-name, that listener stays untouched and
 *     marketplace-orders silently skip email-send.
 *   - Future C13.2 (uploadOrderInvoice push to eBay) and admin bell-
 *     notifications can subscribe to `marketplace.invoice.generated`
 *     without re-wiring anything.
 *
 * Throw-discipline: this listener NEVER throws. Invoice generation
 * failure is logged and swallowed — order-import success path is not
 * affected. The Pull-Cron / Webhook will not re-import the same order
 * because the idempotency-gate (MarketplaceOrderImport unique constraint)
 * marks it as IMPORTED. A retry is the admin's responsibility for now —
 * a future iteration could add an `EBAY_INVOICE_REGENERATE_NEEDED`
 * audit-action.
 */

import { Injectable, Logger } from '@nestjs/common'
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter'
import { InvoiceService } from '../invoice.service'
import {
  MARKETPLACE_ORDER_EVENTS,
  MarketplaceOrderImportedEvent,
} from '../../orders/events/marketplace-order-imported.event'
import {
  MARKETPLACE_INVOICE_EVENTS,
  MarketplaceInvoiceGeneratedEvent,
} from '../../orders/events/marketplace-invoice-generated.event'

@Injectable()
export class MarketplaceInvoiceListener {
  private readonly logger = new Logger(MarketplaceInvoiceListener.name)

  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent(MARKETPLACE_ORDER_EVENTS.IMPORTED)
  async handleOrderImported(event: MarketplaceOrderImportedEvent): Promise<void> {
    try {
      const { invoice, pdfBuffer } = await this.invoiceService.generateAndStoreInvoice(
        event.orderId,
      )

      this.logger.log(
        `[${event.correlationId}] Marketplace invoice ${invoice.invoiceNumber} generated for ${event.orderNumber} (marketplace=${event.marketplace})`,
      )

      // Fire-and-forget emit. Subscribers (none today, C13.2 will add
      // uploadOrderInvoice) MUST also be try/catch-internal — no failure
      // here is fatal to the order import.
      this.eventEmitter.emit(
        MARKETPLACE_INVOICE_EVENTS.GENERATED,
        new MarketplaceInvoiceGeneratedEvent(
          event.orderId,
          event.orderNumber,
          invoice.invoiceNumber,
          Number(invoice.grossAmount).toFixed(2),
          pdfBuffer,
          event.marketplace,
          event.externalOrderId,
          event.correlationId,
        ),
      )
    } catch (err: any) {
      this.logger.error(
        `[${event.correlationId}] Marketplace invoice generation FAILED for order ${event.orderNumber}: ${err?.message ?? err}`,
      )
      // Swallow — order-import is a separate code path and must not be
      // affected. Admin can manually trigger via /admin/invoices.
    }
  }
}
