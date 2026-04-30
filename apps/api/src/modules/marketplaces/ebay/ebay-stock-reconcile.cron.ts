/**
 * eBay Stock Reconcile-Cron (C15).
 *
 * Runs every 15 minutes. Thin wrapper around
 * EbayStockReconcileService.runReconcileTick(). The actual logic
 * (load candidate listings, compute drift, batch-push, audit-summary)
 * lives in the service for testability.
 *
 * Same SafeCron pattern as EbayOrderPullCron + EbayShippingPushCron +
 * EbayRefundPollCron.
 *
 * Why a separate class:
 *   SafeCron registration requires NestJS DI; testing the algorithm
 *   without spinning up the scheduler is much easier when the cron
 *   class is a thin DI-only wrapper and all logic is in a service.
 *
 * The service swallows business outcomes inside its summary — we
 * don't add a try/catch here. Truly unexpected throws (network OOM,
 * etc.) bubble to SafeCron's crash-event emitter.
 */

import { Injectable } from '@nestjs/common'
import { SafeCron } from '../../../common/decorators/safe-cron.decorator'
import { EbayStockReconcileService } from './ebay-stock-reconcile.service'

@Injectable()
export class EbayStockReconcileCron {
  constructor(private readonly reconcileService: EbayStockReconcileService) {}

  @SafeCron('*/15 * * * *', { name: 'ebay-stock-reconcile' })
  async tick(): Promise<void> {
    await this.reconcileService.runReconcileTick()
  }
}
