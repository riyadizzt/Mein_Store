/**
 * MarketplaceImportService (C12.4 Glue).
 *
 * Connects three Phase-2 components into one end-to-end import flow:
 *   - C12.1 PrismaMarketplaceImportStore (idempotency + lifecycle)
 *   - C12.2 EbayOrderAdapter (raw-payload → MarketplaceOrderDraft)
 *   - C12.3 OrdersService.createFromMarketplace (Order + Payment +
 *           History atomic, MarketplaceOrderImportedEvent emit)
 *
 * Public API: processMarketplaceOrderEvent(event)
 *
 * Used by:
 *   - C12.4 EbayOrderNotificationService (webhook receiver)
 *   - C12.5 EbayOrderPullCron (will reuse the same glue, future commit)
 *
 * Not coupled to a specific marketplace — accepts any
 * MarketplaceImportEvent. The adapter is selected via DI per
 * marketplace (today only EbayOrderAdapter; TIKTOK adapter in Phase 3).
 *
 * Throw-discipline: this service NEVER throws for business-logic
 * failures. Every outcome is encoded in the returned ImportOutcome.
 * The webhook caller returns 204 OK regardless. Only EbayNotConnected
 * /EbayRefreshRevoked errors bubble up so the caller can return 503.
 */

import { Injectable, Logger } from '@nestjs/common'
import { OrderImportFlow, FLOW_AUDIT_ACTIONS } from './core/order-import-flow'
import type { MarketplaceImportEvent } from './core/types'
import type { IOrderImporter } from './core/adapter.interfaces'
import { EbayOrderAdapter } from './ebay/ebay-order.adapter'
import { PrismaMarketplaceImportStore } from './adapters/prisma-marketplace-import-store'
import { MarketplaceAuditAdapter } from './adapters/marketplace-audit.adapter'
import { MarketplaceNotificationAdapter } from './adapters/marketplace-notification.adapter'
import { OrdersService } from '../orders/orders.service'
import { DuplicateOrderException } from '../orders/exceptions/duplicate-order.exception'
import { PrismaService } from '../../prisma/prisma.service'

export type ImportOutcome =
  | { status: 'imported'; importId: string; orderId: string; orderNumber: string }
  | { status: 'skipped'; importId: string; reason: 'already_exists'; existingOrderId?: string | null }
  | { status: 'failed'; importId?: string; reason: string; errorKind: 'mapping' | 'insufficient_stock' | 'unknown' }

@Injectable()
export class MarketplaceImportService {
  private readonly logger = new Logger(MarketplaceImportService.name)

  constructor(
    private readonly ebayAdapter: EbayOrderAdapter,
    private readonly store: PrismaMarketplaceImportStore,
    private readonly audit: MarketplaceAuditAdapter,
    private readonly notify: MarketplaceNotificationAdapter,
    private readonly ordersService: OrdersService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Drive the full import lifecycle for a single MarketplaceImportEvent.
   * Webhook returns 204 regardless of outcome. Pull-cron uses outcome
   * for batch summary reporting.
   */
  async processMarketplaceOrderEvent(event: MarketplaceImportEvent): Promise<ImportOutcome> {
    const importer = this.selectImporter(event.marketplace)
    const flow = new OrderImportFlow({
      importer,
      store: this.store,
      audit: this.audit,
      notify: this.notify,
    })

    const flowResult = await flow.run(event)

    if (flowResult.status === 'skipped') {
      return {
        status: 'skipped',
        importId: flowResult.importId,
        reason: 'already_exists',
        existingOrderId: flowResult.existingOrderId,
      }
    }

    if (flowResult.status === 'failed') {
      return {
        status: 'failed',
        importId: flowResult.importId,
        reason: flowResult.error,
        errorKind: flowResult.errorKind,
      }
    }

    // status === 'imported' — flow returned the draft.
    // Re-resolve buyer (cheap, deterministic — adapter does not cache).
    // Alternative would be to bake buyer into FlowOutcome — ergonomic
    // but couples C9 to C12 contracts. Keep flow-marketplace-agnostic.
    const importId = flowResult.importId
    const draft = flowResult.draft
    const buyer = await importer.resolveBuyer(event)

    const channelValue = event.marketplace === 'EBAY' ? 'ebay' : 'tiktok'
    let order: { id: string; orderNumber: string }
    try {
      order = await this.ordersService.createFromMarketplace(
        draft,
        buyer,
        event.marketplace,
        flowResult.externalOrderId,
        event.rawEventId ?? `corr-${Date.now()}`,
      )
    } catch (e: any) {
      if (e instanceof DuplicateOrderException) {
        // P2002 race: order with same (channel, channelOrderId) already
        // exists locally. Per Q-7 Error-Table + user-clarification 1:
        // Lookup existing order, markImported(linked), return skipped.
        this.logger.warn(
          `[marketplace-import] DuplicateOrderException for ${flowResult.externalOrderId} — looking up existing order`,
        )
        try {
          const existing = await this.prisma.order.findFirst({
            where: { channel: channelValue as any, channelOrderId: flowResult.externalOrderId, deletedAt: null },
            select: { id: true, orderNumber: true },
          })
          if (existing) {
            await this.store.markImported(importId, existing.id, {
              externalOrderId: flowResult.externalOrderId,
              orderNumber: existing.orderNumber,
              linkedFromDuplicate: true,
            })
            return {
              status: 'skipped',
              importId,
              reason: 'already_exists',
              existingOrderId: existing.id,
            }
          }
          // Lookup failed — fallback to markFailed
          await this.store.markFailed(importId, 'duplicate_order_lookup_failed', {
            externalOrderId: flowResult.externalOrderId,
          })
          return {
            status: 'failed',
            importId,
            reason: 'duplicate_order_lookup_failed',
            errorKind: 'unknown',
          }
        } catch (lookupErr: any) {
          this.logger.error(
            `[marketplace-import] Lookup after DuplicateOrderException failed: ${lookupErr?.message ?? lookupErr}`,
          )
          await this.store.markFailed(importId, 'duplicate_order_lookup_failed', {
            externalOrderId: flowResult.externalOrderId,
          })
          return {
            status: 'failed',
            importId,
            reason: 'duplicate_order_lookup_failed',
            errorKind: 'unknown',
          }
        }
      }
      const msg = String(e?.message ?? e).slice(0, 500)
      this.logger.error(
        `[marketplace-import] createFromMarketplace error for ${flowResult.externalOrderId}: ${msg}`,
      )
      await this.store.markFailed(importId, msg, { errorKind: 'unknown' })
      return { status: 'failed', importId, reason: msg, errorKind: 'unknown' }
    }

    await this.store.markImported(importId, order.id, {
      externalOrderId: flowResult.externalOrderId,
      orderNumber: order.orderNumber,
      buyerExternalRef: buyer.externalBuyerRef,
    })
    await this.audit.log({
      action: FLOW_AUDIT_ACTIONS.IMPORTED,
      entityType: 'order',
      entityId: order.id,
      changes: {
        marketplace: event.marketplace,
        externalOrderId: flowResult.externalOrderId,
        orderNumber: order.orderNumber,
      },
    })

    return { status: 'imported', importId, orderId: order.id, orderNumber: order.orderNumber }
  }

  private selectImporter(marketplace: 'EBAY' | 'TIKTOK'): IOrderImporter {
    if (marketplace === 'EBAY') return this.ebayAdapter
    throw new Error(`Marketplace ${marketplace} not yet supported`)
  }
}
