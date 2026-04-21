/**
 * Self-healing safety-stock sweep (C5).
 *
 * Runs every 5 minutes. Iterates over all variants that have at least
 * one ChannelProductListing row in a status where it might need to
 * transition (active, pending, or paused+low_stock) and invokes the
 * shared `propagateChannelSafety` helper for each.
 *
 * Why this exists
 * ──────────────
 * Event-path invalidation from ReservationService +
 * AdminInventoryService.intake is the primary trigger. The cron is a
 * safety net for any edge case where an event was missed:
 *   - Process restart mid-reservation (event never fires)
 *   - Direct SQL write by a DB admin (bypasses the service layer)
 *   - Future code paths that forget the fire-and-forget call
 *
 * It's explicitly allowed to be idempotent — running it on an
 * already-reconciled listing is a no-op (decideSafetyTransition
 * returns null). Each run self-reports via the logger.
 *
 * Wiring
 * ──────
 * Provided by AdminModule (lives next to payment-timeout.cron,
 * expiry-reminder.cron). Registers its AdminModule's AuditService +
 * NotificationService into the safety-stock helper's singleton refs
 * at bootstrap so the event-path call-sites (ReservationService +
 * AdminInventoryService) can reach them without DI cycles.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { SafeCron } from '../../../common/decorators/safe-cron.decorator'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditService } from '../services/audit.service'
import { NotificationService } from '../services/notification.service'
import {
  propagateChannelSafety,
  registerChannelSafetyAuditor,
  registerChannelSafetyNotifier,
} from '../../../common/helpers/channel-safety-stock'

@Injectable()
export class ChannelSafetyStockCron implements OnModuleInit {
  private readonly logger = new Logger(ChannelSafetyStockCron.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * At bootstrap, register our AdminModule-resident services into the
   * safety-stock helper's singleton refs so event-path callers
   * (ReservationService, AdminInventoryService) can reach them
   * without creating a module-import cycle. Same pattern as the
   * channel-feed-cache-ref registration in FeedsService.
   */
  onModuleInit(): void {
    registerChannelSafetyAuditor(this.audit)
    registerChannelSafetyNotifier(this.notifications)
  }

  @SafeCron('*/5 * * * *') // Every 5 minutes — matches the payment-timeout cadence
  async sweep() {
    // Find every variant with at least one potentially-transitionable
    // listing. Defensive cap at 10k rows — the prod DB is nowhere
    // near that, and hitting the cap would indicate a pathological
    // event loop we'd want to surface rather than silently truncate.
    const distinctVariants = await this.prisma.channelProductListing.findMany({
      where: {
        OR: [
          { status: 'active' },
          { status: 'pending' },
          { status: 'paused', pauseReason: 'low_stock' },
        ],
        variantId: { not: null },
      },
      select: { variantId: true },
      distinct: ['variantId'],
      take: 10_000,
    })
    const variantIds = distinctVariants
      .map((r) => r.variantId)
      .filter((v): v is string => typeof v === 'string')
    if (variantIds.length === 0) {
      this.logger.debug('safety-stock sweep: no candidate listings')
      return
    }

    const result = await propagateChannelSafety(
      this.prisma as any,
      variantIds,
      this.notifications,
      this.audit,
    )
    if (result.paused > 0 || result.resumed > 0) {
      this.logger.log(
        `safety-stock sweep: paused=${result.paused} resumed=${result.resumed} skipped=${result.skipped} (${variantIds.length} variants checked)`,
      )
    } else {
      this.logger.debug(
        `safety-stock sweep: no transitions needed (${variantIds.length} variants checked)`,
      )
    }
  }
}
