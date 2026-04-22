/**
 * eBay Token-Refresh Cron (C10).
 *
 * Runs every 90 minutes (access tokens live 2 hours — refreshing
 * with ~30 min buffer avoids mid-request expiry). Proactively calls
 * EbayAuthService.getAccessTokenOrRefresh() so the next inbound
 * webhook or cron-pull finds a fresh token cached in DB.
 *
 * On refresh-token-revoked error: a Critical admin notification is
 * raised (eBay reauthorization needed). Cron MUST NOT silently fail.
 *
 * @SafeCron (Phase-1 C5 infrastructure) wraps the task in a
 * try/catch and a Sentry alert. Consistent with all other crons
 * in the repo.
 */

import { Injectable, Logger } from '@nestjs/common'
import { SafeCron } from '../../../common/decorators/safe-cron.decorator'
import { PrismaService } from '../../../prisma/prisma.service'
import {
  EbayAuthService,
  EbayNotConnectedError,
  EbayRefreshRevokedError,
} from './ebay-auth.service'
import { MarketplaceNotificationAdapter } from '../adapters/marketplace-notification.adapter'
import { AuditService } from '../../admin/services/audit.service'

@Injectable()
export class EbayTokenRefreshCron {
  private readonly logger = new Logger(EbayTokenRefreshCron.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: EbayAuthService,
    private readonly notify: MarketplaceNotificationAdapter,
    private readonly audit: AuditService,
  ) {}

  @SafeCron('0 */90 * * * *', { name: 'ebay-token-refresh' })
  async sweep(): Promise<void> {
    // Short-circuit if no connection row exists. Common state
    // during fresh installs / before first OAuth connect.
    const row = await this.prisma.salesChannelConfig.findUnique({
      where: { channel: 'ebay' },
      select: { isActive: true, accessToken: true, tokenExpiresAt: true },
    })
    if (!row || !row.isActive || !row.accessToken) {
      return // nothing to refresh
    }

    try {
      await this.auth.getAccessTokenOrRefresh()
      // getAccessTokenOrRefresh is a no-op if token is still valid —
      // it only touches the API if we're inside the 2-minute expiry
      // window. Cron running every 90 min ensures we always hit it
      // before expiry.
    } catch (e) {
      if (e instanceof EbayRefreshRevokedError) {
        this.logger.error('eBay refresh token revoked — connection marked inactive')
        await this.notify.notifyAdmins({
          type: 'ebay_oauth_revoked',
          data: { reason: 'refresh_token_revoked' },
        })
        await this.audit.log({
          action: 'EBAY_OAUTH_REVOKED',
          entityType: 'sales_channel_config',
          entityId: 'ebay',
          adminId: 'system',
          changes: { after: { source: 'token-refresh-cron' } },
        })
        return
      }
      if (e instanceof EbayNotConnectedError) {
        // Unlikely — we checked above — but log and move on.
        this.logger.warn(`Token refresh encountered NotConnected: ${e.message}`)
        return
      }
      // Unknown error — let SafeCron surface it to Sentry.
      throw e
    }
  }
}
