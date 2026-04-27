/**
 * MarketplaceOversellListener (C12.3).
 *
 * Reacts to 'marketplace.oversell.drift' events from
 * OrdersService.createFromMarketplace when a marketplace-imported order
 * arrives with stock that disagrees with the local count.
 *
 * eBay / TikTok already promised the buyer their item — we MUST import
 * the order regardless. This listener surfaces the drift so admin can:
 *   1. ship from a non-default warehouse
 *   2. backorder + restock notification
 *   3. cancel + refund via marketplace API (last resort)
 *
 * Loose-coupled via EventEmitter (no DI in OrdersService — N2 decision).
 */

import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { NotificationService } from '../services/notification.service'

interface OversellDriftPayload {
  externalOrderId: string
  lines: Array<{
    variantId: string
    sku: string
    requested: number
    available: number
  }>
  correlationId: string
}

@Injectable()
export class MarketplaceOversellListener {
  private readonly logger = new Logger(MarketplaceOversellListener.name)

  constructor(private readonly notificationService: NotificationService) {}

  @OnEvent('marketplace.oversell.drift')
  async handleOversellDrift(payload: OversellDriftPayload): Promise<void> {
    try {
      const totalShortage = payload.lines.reduce(
        (sum, l) => sum + (l.requested - l.available),
        0,
      )
      const skus = payload.lines.map((l) => l.sku).join(', ')
      await this.notificationService.createForAllAdmins({
        type: 'marketplace_oversell_drift',
        title: `Marketplace-Übermenge für Order ${payload.externalOrderId}`,
        body: `${payload.lines.length} Variante(n) drift, fehlend: ${totalShortage} Stück. SKUs: ${skus}`,
        entityType: 'order',
        entityId: payload.externalOrderId,
        data: {
          externalOrderId: payload.externalOrderId,
          lineCount: payload.lines.length,
          driftedSkus: payload.lines.map((l) => l.sku),
          totalShortage,
          lines: payload.lines,
        },
      })
      this.logger.warn(
        `[${payload.correlationId}] Oversell-drift notification dispatched for ${payload.externalOrderId} (${payload.lines.length} lines)`,
      )
    } catch (err: any) {
      // Never let notification failure block import — log and move on.
      this.logger.error(
        `[${payload.correlationId}] Failed to dispatch oversell-drift notification: ${err?.message ?? err}`,
      )
    }
  }
}
