import { Injectable, Logger } from '@nestjs/common'
import { AuditTier } from '@prisma/client'
import { PrismaService } from '../../../prisma/prisma.service'

/**
 * C15.1 — Three-tier audit classification.
 *
 * MUST stay byte-equal to the action-lists in
 * prisma/migrations/20260502_audit_tier_and_webhook_idempotency/migration.sql
 * because the migration's backfill UPDATE matches against these
 * exact strings. A drift here = retention-policy mismatch between
 * existing rows (DB-side classified) and new rows (service-side
 * classified). The audit-tier-backfill.spec test asserts both lists
 * are identical byte-for-byte.
 *
 * NEW financial actions: add to FINANCIAL_ACTIONS + the migration's
 * action-list. Both lists must be touched in the same PR.
 * NEW ephemeral actions: same pattern with EPHEMERAL_ACTIONS.
 */

/**
 * GoBD §147 AO — these audit-rows MUST never be deleted (10-year
 * retention). The audit-archive cron skips this tier entirely.
 */
export const FINANCIAL_ACTIONS: ReadonlySet<string> = new Set<string>([
  // Invoices & Credit Notes
  'INVOICE_CREATED',
  'INVOICE_GENERATED',
  'MARKETPLACE_INVOICE_GENERATED',
  'CREDIT_NOTE_GENERATED',
  // Payment lifecycle
  'PAYMENT_CREATED',
  'PAYMENT_CAPTURED',
  'PAYMENT_DISPUTED',
  // Refund lifecycle (all providers)
  'REFUND_INITIATED',
  'REFUND_COMPLETED',
  'REFUND_FAILED',
  'EBAY_REFUND_COMPLETED',
  'EBAY_REFUND_FAILED',
  'EBAY_REFUND_PENDING_48H',
  'EBAY_REFUND_MANUALLY_CONFIRMED',
  'VORKASSE_REFUND_CONFIRMED',
  // Money-bearing cancels (PRE_PAYMENT is operational — no money moved)
  'ORDER_CANCELLED_POST_PAYMENT',
  // Return-flows that touch money
  'RETURN_REFUNDED',
  'RETURN_REFUND_FAILED',
  'PAYMENT_TIMEOUT_REFUNDED',
  // Audit-archive itself — regulatory traceability of the archive
  // process. The decision to delete operational data must itself
  // leave a permanent audit-trail. Owner-decision Q-9.
  'AUDIT_ARCHIVE_COMPLETED',
  'AUDIT_ARCHIVE_FAILED',
])

/**
 * High-volume noise events with zero regulatory or business value.
 * 7-day retention then PERMANENT delete (no R2 archive). Add new
 * eBay/marketplace spam-events here as they're identified.
 */
export const EPHEMERAL_ACTIONS: ReadonlySet<string> = new Set<string>([
  // eBay sends one per affected service when a user requests account
  // deletion — typically 5-10 per actual user. Live-DB analysis on
  // 2026-05-01 found 11.200 rows. No GoBD relevance: we already log
  // dataFoundInDb=false for all of them today (no eBay-buyer data
  // pre-C12). Post-C12 the redaction-result is still captured in the
  // EbayDeletionNotification table, NOT here.
  'EBAY_ACCOUNT_DELETION_RECEIVED',
  // Webhook duplicate-deliveries caught by the C15.1 pre-check.
  // Pure observability — no decision-trail attached.
  'EBAY_WEBHOOK_DUPLICATE',
])

/**
 * Auto-classify an action. Set wins over caller-override (caller can
 * UPGRADE operational→financial via opts.tier, but cannot DOWNGRADE
 * a financial action; same for ephemeral).
 *
 * Defense-in-depth: if a caller bug ever passes tier='ephemeral' for
 * INVOICE_GENERATED, this function still returns 'financial'.
 */
export function determineAuditTier(
  action: string,
  override?: AuditTier,
): AuditTier {
  if (FINANCIAL_ACTIONS.has(action)) return 'financial'
  if (EPHEMERAL_ACTIONS.has(action)) return 'ephemeral'
  // Not in any Set — caller may override (e.g. legacy operational
  // event that owner wants to upgrade). Default operational.
  return override ?? 'operational'
}

export interface AuditLogEntry {
  adminId: string
  action: string
  entityType: string
  entityId?: string
  changes?: { before?: Record<string, unknown>; after?: Record<string, unknown> }
  ipAddress?: string
  /**
   * C15.1 optional override. Defaults via determineAuditTier:
   *   - action ∈ FINANCIAL_ACTIONS → 'financial' (override IGNORED)
   *   - action ∈ EPHEMERAL_ACTIONS → 'ephemeral' (override IGNORED)
   *   - otherwise → override ?? 'operational'
   * Caller-override can never DOWNGRADE — Set membership wins.
   */
  tier?: AuditTier
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditLogEntry): Promise<void> {
    const tier = determineAuditTier(entry.action, entry.tier)
    await this.prisma.adminAuditLog.create({
      data: {
        adminId: entry.adminId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        changes: entry.changes as any,
        ipAddress: entry.ipAddress,
        tier,
      },
    })

    this.logger.log(
      `AUDIT[${tier}]: ${entry.action} | ${entry.entityType}:${entry.entityId ?? '-'} | by=${entry.adminId}`,
    )
  }

  async findAll(query: {
    adminId?: string
    action?: string
    page?: number
    limit?: number
  }) {
    const page = query.page ?? 1
    const limit = query.limit ?? 50
    const where: any = {}
    if (query.adminId) where.adminId = query.adminId
    if (query.action) where.action = { contains: query.action, mode: 'insensitive' }

    const [items, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.adminAuditLog.count({ where }),
    ])

    // Resolve admin names
    const adminIds = [...new Set(items.map((i) => i.adminId))]
    const admins = await this.prisma.user.findMany({
      where: { id: { in: adminIds } },
      select: { id: true, firstName: true, lastName: true, email: true },
    })
    const adminMap = new Map(admins.map((a) => [a.id, a]))

    return {
      data: items.map((log) => {
        const admin = adminMap.get(log.adminId)
        return {
          ...log,
          adminName: admin ? `${admin.firstName} ${admin.lastName}` : log.adminId.slice(0, 8),
          adminEmail: admin?.email,
        }
      }),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    }
  }

  async getAdmins() {
    return this.prisma.user.findMany({
      where: { role: { in: ['admin', 'super_admin'] }, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: 'asc' },
    })
  }

  async getActionTypes() {
    const actions = await this.prisma.adminAuditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    })
    return actions.map((a) => a.action)
  }

  async getRecentActions(limit = 10) {
    return this.prisma.adminAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  async getByEntity(entityType: string, entityId: string) {
    return this.prisma.adminAuditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
    })
  }
}
