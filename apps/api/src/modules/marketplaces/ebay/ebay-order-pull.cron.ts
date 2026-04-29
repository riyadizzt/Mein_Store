/**
 * eBay Order Pull-Cron (C12.5).
 *
 * Runs every 15 minutes. Thin wrapper around EbayOrderPullService —
 * the actual logic lives there for testability.
 *
 * Why a separate class:
 *   Same pattern as EbayTokenRefreshCron. SafeCron registration
 *   requires NestJS DI; testing the algorithm directly without
 *   spinning up the scheduler is much easier with a service.
 *
 * The service swallows business outcomes inside its summary —
 * we don't add a try/catch here. Truly unexpected throws (network,
 * OOM, etc.) bubble to SafeCron's crash-event emission.
 */

import { Injectable } from '@nestjs/common'
import { SafeCron } from '../../../common/decorators/safe-cron.decorator'
import { EbayOrderPullService } from './ebay-order-pull.service'

@Injectable()
export class EbayOrderPullCron {
  constructor(private readonly pullService: EbayOrderPullService) {}

  @SafeCron('*/15 * * * *', { name: 'ebay-order-pull' })
  async tick(): Promise<void> {
    await this.pullService.runPullTick()
  }
}
