/**
 * MarketplaceNotificationAdapter (C10).
 *
 * Narrow-surface wrapper around the existing NotificationService.
 * Exists so the marketplace core layer stays DI-free — it depends
 * on the MarketplaceNotificationPort contract from C9.
 *
 * Marketplace flow fires notifications with lean payloads
 * ({ type, data }); the admin UI resolves title/body via the
 * existing translateNotif i18n helper in notif-i18n.ts, consistent
 * with Phase-1 C5 channel_auto_paused pattern. The adapter
 * provides conservative default title/body fallbacks so even
 * an unmapped notification type renders as something, not blank.
 */

import { Injectable, Logger } from '@nestjs/common'
import { NotificationService } from '../../admin/services/notification.service'
import type { MarketplaceNotificationPort } from '../core/types'

@Injectable()
export class MarketplaceNotificationAdapter implements MarketplaceNotificationPort {
  private readonly logger = new Logger(MarketplaceNotificationAdapter.name)

  constructor(private readonly notifications: NotificationService) {}

  async notifyAdmins(
    event: Parameters<MarketplaceNotificationPort['notifyAdmins']>[0],
  ): Promise<void> {
    try {
      await this.notifications.createForAllAdmins({
        type: event.type,
        title: this.fallbackTitle(event.type),
        body: this.fallbackBody(event.type),
        channel: 'admin',
        data: event.data,
      })
    } catch (e: any) {
      this.logger.warn(
        `Notification delegation failed for type=${event.type}: ${e?.message ?? e}`,
      )
      // Swallow — notification failure must never break the flow.
    }
  }

  // Frontend notif-i18n.ts resolves these properly (3 languages).
  // These fallbacks show only if someone checks the raw DB row.
  private fallbackTitle(type: string): string {
    const map: Record<string, string> = {
      marketplace_oversell_alert: 'Marketplace oversell alert',
      ebay_oauth_revoked: 'eBay authorization revoked',
    }
    return map[type] ?? `Marketplace event: ${type}`
  }

  private fallbackBody(type: string): string {
    return `A marketplace event of type ${type} occurred. Open the dashboard for details.`
  }
}
