/**
 * eBay Refund Poll-Cron (C13.3).
 *
 * Runs every 60 minutes. Thin wrapper around EbayRefundPollService —
 * the actual logic lives there for testability.
 *
 * Same SafeCron pattern as EbayOrderPullCron + EbayTokenRefreshCron:
 * exceptions bubble to the cron crash-event emitter so the admin
 * gets a bell-notification if the cron itself fails.
 */

import { Injectable } from '@nestjs/common'
import { SafeCron } from '../../../common/decorators/safe-cron.decorator'
import { EbayRefundPollService } from './ebay-refund-poll.service'

@Injectable()
export class EbayRefundPollCron {
  constructor(private readonly pollService: EbayRefundPollService) {}

  @SafeCron('0 * * * *', { name: 'ebay-refund-poll' })
  async tick(): Promise<void> {
    await this.pollService.runPollTick()
  }
}
