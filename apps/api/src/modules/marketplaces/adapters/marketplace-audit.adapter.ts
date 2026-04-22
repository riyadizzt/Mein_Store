/**
 * MarketplaceAuditAdapter (C10).
 *
 * Narrow-surface wrapper around the existing AuditService. Exists
 * so the marketplace core layer stays DI-free — it depends on the
 * MarketplaceAuditPort contract from C9, not on NestJS or the
 * AuditService class. The adapter does the translation.
 *
 * Null-touch: delegates to AuditService; no direct DB writes from
 * the marketplace side.
 */

import { Injectable, Logger } from '@nestjs/common'
import { AuditService } from '../../admin/services/audit.service'
import type { MarketplaceAuditPort } from '../core/types'

@Injectable()
export class MarketplaceAuditAdapter implements MarketplaceAuditPort {
  private readonly logger = new Logger(MarketplaceAuditAdapter.name)

  constructor(private readonly audit: AuditService) {}

  async log(event: Parameters<MarketplaceAuditPort['log']>[0]): Promise<void> {
    try {
      await this.audit.log({
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        // AuditService requires a non-null adminId. Marketplace flow
        // events are system-triggered (webhook / cron) — we pass
        // 'system' matching Phase-1 convention (payment-timeout cron,
        // maintenance service).
        adminId: event.adminId ?? 'system',
        // AuditLogEntry.changes uses { before?, after? }. Marketplace
        // port accepts a flat record — we wrap under `after` since
        // these events describe newly-created state (import row,
        // marketplace event, etc.), not mutations of existing state.
        changes: event.changes ? { after: event.changes } : undefined,
      })
    } catch (e: any) {
      this.logger.warn(
        `Audit delegation failed for ${event.action} ${event.entityId}: ${e?.message ?? e}`,
      )
      // Swallow — audit failure must never break a marketplace flow.
      // The flow.safeAudit wrapper already swallows, but double-
      // protection keeps the contract solid in all call sites.
    }
  }
}
