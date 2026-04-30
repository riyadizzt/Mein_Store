/**
 * eBay Shipping Push Retry Cron (C14).
 *
 * Runs every 30 minutes. Thin wrapper around
 * EbayShippingPushService.retryFailedPushes(). The actual logic
 * (DB scan, retry-loop, attempt-counter, admin-notify on max-cap)
 * lives in the service for testability.
 *
 * Same SafeCron pattern as EbayOrderPullCron + EbayRefundPollCron.
 */

import { Injectable } from '@nestjs/common'
import { SafeCron } from '../../../common/decorators/safe-cron.decorator'
import { EbayShippingPushService } from './ebay-shipping-push.service'

@Injectable()
export class EbayShippingPushCron {
  constructor(private readonly pushService: EbayShippingPushService) {}

  @SafeCron('*/30 * * * *', { name: 'ebay-shipping-push-retry' })
  async tick(): Promise<void> {
    await this.pushService.retryFailedPushes()
  }
}
