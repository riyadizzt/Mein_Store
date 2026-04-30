/**
 * EbayRefundPollService (C13.3).
 *
 * 60-min cron-driven poll of pending eBay-refunds. eBay's
 * issue_refund API returns immediately with refundId+status='INITIATED'
 * but the actual money-transfer + buyer-confirmation happen later
 * inside eBay's processing. This service polls for status transitions
 * and updates our refund row accordingly.
 *
 * Per S-4 amended (Pfad Alpha — Vorkasse-pattern):
 *   Credit Note already exists at refund creation. The poll only
 *   flips refund.status PENDING → PROCESSED or FAILED. Credit-Note
 *   generation/storno is NOT this service's concern.
 *
 * Architecture:
 *   - Scan refunds WHERE status=PENDING AND payment.provider=EBAY_MANAGED_PAYMENTS
 *     AND providerRefundId IS NOT NULL (need an ID to poll)
 *   - For each: GET /sell/fulfillment/v1/order/{orderId}
 *     → extract refund-status from eBay response via Defensive-Multi-Path
 *       (Y-3 decision)
 *   - Map eBay-status → our status:
 *       'COMPLETED' / 'SUCCEEDED' → 'PROCESSED' + processedAt=now + audit
 *       'FAILED' / 'REJECTED'     → 'FAILED' + admin-notify + audit
 *       (anything else)            → no-op, still pending
 *   - On >48h still-pending: admin-notify "manuell prüfen" once (S-5)
 *
 * First-Run-Logging (Y-2 decision):
 *   On first poll-tick after deploy, log the FULL raw getOrder
 *   response per eBay-orderId. Helps debug Schema-Drift in case
 *   the Defensive-Multi-Path didn't catch the right field.
 *
 * Hard-rules:
 *   - PaymentsService.refund() ZERO TOUCH
 *   - InvoiceService ZERO TOUCH
 *   - Existing Refund-row touched only on: status, processedAt
 *     (the C13.3 ebayRequestedAt column lives separately)
 *   - Per-refund try/catch: one broken refund must NOT abort the tick
 */

import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'
import { resolveEbayEnv } from './ebay-env'
import {
  EbayAuthService,
  EbayNotConnectedError,
  EbayRefreshRevokedError,
} from './ebay-auth.service'
import { EbayApiClient } from './ebay-api.client'
import { AuditService } from '../../admin/services/audit.service'
import { NotificationService } from '../../admin/services/notification.service'

const POLL_BATCH_LIMIT = 50
const FALLBACK_THRESHOLD_HOURS = 48

export const REFUND_AUDIT_ACTIONS = {
  COMPLETED: 'EBAY_REFUND_COMPLETED',
  FAILED: 'EBAY_REFUND_FAILED',
  PENDING_48H: 'EBAY_REFUND_PENDING_48H',
} as const

export interface RefundPollSummary {
  status: 'completed' | 'skipped_disconnected' | 'aborted_revoked'
  scanned: number
  flippedToProcessed: number
  flippedToFailed: number
  notified48h: number
  errors: number
  durationMs: number
}

/**
 * Defensive multi-path refund-status extractor (Y-3 decision).
 *
 * eBay's getOrder() refund-status field path varies by API version.
 * Looks for the specific refundId in three known shapes and
 * extracts the status string.
 */
function findRefundStatusInOrderResponse(orderResponse: any, providerRefundId: string): string | null {
  if (!providerRefundId) return null

  const candidates: any[] = [
    ...(orderResponse?.paymentSummary?.refunds ?? []),
    ...(orderResponse?.refunds ?? []),
  ]
  for (const c of candidates) {
    if (c?.refundId === providerRefundId) {
      return c?.refundStatus ?? c?.state ?? c?.status ?? null
    }
  }
  // Final fallback: top-level refundState
  return orderResponse?.refundState ?? null
}

@Injectable()
export class EbayRefundPollService {
  private readonly logger = new Logger(EbayRefundPollService.name)

  // Tracks orderIds we've already raw-logged this process lifetime.
  // Limits log noise — only first-run-per-order gets the full dump.
  private readonly rawLoggedOrderIds = new Set<string>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: EbayAuthService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * One poll tick. Never throws on business outcomes.
   * Returns a structured summary for testing + cron logging.
   */
  async runPollTick(): Promise<RefundPollSummary> {
    const tickStart = Date.now()
    const empty = (status: RefundPollSummary['status']): RefundPollSummary => ({
      status,
      scanned: 0,
      flippedToProcessed: 0,
      flippedToFailed: 0,
      notified48h: 0,
      errors: 0,
      durationMs: Date.now() - tickStart,
    })

    // Pre-check eBay connection (existing pattern from C12.5 Pull-Cron)
    const config = await this.prisma.salesChannelConfig.findUnique({
      where: { channel: 'ebay' },
      select: { isActive: true, accessToken: true },
    })
    if (!config?.isActive || !config?.accessToken) {
      this.logger.warn('[ebay-refund-poll] not connected — skip')
      return empty('skipped_disconnected')
    }

    // Get bearer token (early-exit on auth errors)
    let bearer: string
    try {
      bearer = await this.auth.getAccessTokenOrRefresh()
    } catch (e) {
      if (e instanceof EbayRefreshRevokedError) {
        this.logger.warn('[ebay-refund-poll] aborted — refresh-token revoked')
        return empty('aborted_revoked')
      }
      if (e instanceof EbayNotConnectedError) {
        this.logger.warn(`[ebay-refund-poll] not connected: ${e.message}`)
        return empty('skipped_disconnected')
      }
      throw e
    }

    // Scan pending refunds for EBAY_MANAGED_PAYMENTS payments
    const pendingRefunds = await this.prisma.refund.findMany({
      where: {
        status: 'PENDING',
        providerRefundId: { not: null },
        payment: { provider: 'EBAY_MANAGED_PAYMENTS' },
      },
      include: {
        payment: {
          include: {
            order: {
              select: { id: true, orderNumber: true, channelOrderId: true },
            },
          },
        },
      },
      take: POLL_BATCH_LIMIT,
      orderBy: { createdAt: 'asc' },
    })

    const env = resolveEbayEnv()
    const client = new EbayApiClient(env)
    const counters = {
      flippedToProcessed: 0,
      flippedToFailed: 0,
      notified48h: 0,
      errors: 0,
    }

    for (const refund of pendingRefunds) {
      try {
        await this.processRefund(refund, client, bearer, counters)
      } catch (e: any) {
        counters.errors++
        this.logger.error(
          `[ebay-refund-poll] error refund=${refund.id}: ${e?.message ?? e}`,
        )
      }
    }

    const summary: RefundPollSummary = {
      status: 'completed',
      scanned: pendingRefunds.length,
      ...counters,
      durationMs: Date.now() - tickStart,
    }
    if (pendingRefunds.length > 0) {
      this.logger.log(
        `[ebay-refund-poll] tick scanned=${summary.scanned} ` +
          `processed=${summary.flippedToProcessed} ` +
          `failed=${summary.flippedToFailed} ` +
          `notified48h=${summary.notified48h} ` +
          `errors=${summary.errors} duration_ms=${summary.durationMs}`,
      )
    }
    return summary
  }

  // ────────────────────────────────────────────────────────────
  // Per-refund processing
  // ────────────────────────────────────────────────────────────

  private async processRefund(
    refund: any,
    client: EbayApiClient,
    bearer: string,
    counters: { flippedToProcessed: number; flippedToFailed: number; notified48h: number; errors: number },
  ): Promise<void> {
    const orderId: string | null = refund.payment?.order?.channelOrderId ?? null
    if (!orderId) {
      // Cannot poll without orderId — log + skip (won't ever resolve)
      this.logger.warn(
        `[ebay-refund-poll] refund=${refund.id} has no channelOrderId — skipping`,
      )
      return
    }

    let orderResponse: any
    try {
      orderResponse = await client.request<any>(
        'GET',
        `/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}`,
        { bearer, retry: false },
      )
    } catch (e: any) {
      counters.errors++
      this.logger.error(
        `[ebay-refund-poll] getOrder(${orderId}) failed: ${e?.message ?? e}`,
      )
      return
    }

    // First-Run-Logging (Y-2 decision part 1: Railway logger)
    if (!this.rawLoggedOrderIds.has(orderId)) {
      this.rawLoggedOrderIds.add(orderId)
      this.logger.log(
        `[ebay-refund-poll] first-run raw response for order=${orderId}: ` +
          JSON.stringify(orderResponse).slice(0, 1500),
      )
    }

    const ebayStatus = findRefundStatusInOrderResponse(orderResponse, refund.providerRefundId)

    if (ebayStatus === 'COMPLETED' || ebayStatus === 'SUCCEEDED') {
      await this.markProcessed(refund, ebayStatus)
      counters.flippedToProcessed++
    } else if (ebayStatus === 'FAILED' || ebayStatus === 'REJECTED') {
      await this.markFailed(refund, ebayStatus, orderResponse)
      counters.flippedToFailed++
    } else {
      // Still pending or unparseable — check 48h-fallback
      const notified = await this.checkFallback48h(refund)
      if (notified) counters.notified48h++
    }
  }

  // ────────────────────────────────────────────────────────────
  // State transitions
  // ────────────────────────────────────────────────────────────

  private async markProcessed(refund: any, ebayStatus: string): Promise<void> {
    await this.prisma.refund.update({
      where: { id: refund.id },
      data: { status: 'PROCESSED', processedAt: new Date() },
    })
    this.logger.log(
      `[ebay-refund-poll] PROCESSED refund=${refund.id} order=${refund.payment.order.orderNumber} ebayStatus=${ebayStatus}`,
    )
    await this.audit
      .log({
        adminId: 'system',
        action: REFUND_AUDIT_ACTIONS.COMPLETED,
        entityType: 'refund',
        entityId: refund.id,
        changes: {
          after: {
            providerRefundId: refund.providerRefundId,
            orderNumber: refund.payment.order.orderNumber,
            ebayStatus,
          },
        },
      })
      .catch((e: any) =>
        this.logger.warn(`[ebay-refund-poll] audit log failed: ${e?.message ?? e}`),
      )
  }

  private async markFailed(refund: any, ebayStatus: string, orderResponse: any): Promise<void> {
    await this.prisma.refund.update({
      where: { id: refund.id },
      data: { status: 'FAILED' },
    })
    this.logger.error(
      `[ebay-refund-poll] FAILED refund=${refund.id} order=${refund.payment.order.orderNumber} ebayStatus=${ebayStatus}`,
    )
    await this.audit
      .log({
        adminId: 'system',
        action: REFUND_AUDIT_ACTIONS.FAILED,
        entityType: 'refund',
        entityId: refund.id,
        changes: {
          after: {
            providerRefundId: refund.providerRefundId,
            orderNumber: refund.payment.order.orderNumber,
            ebayStatus,
            // Trim to keep audit row payload size sane
            ebayDetail: JSON.stringify(orderResponse).slice(0, 500),
          },
        },
      })
      .catch(() => {})
    await this.notifications
      .createForAllAdmins({
        type: 'refund_failed',
        title: 'eBay-Erstattung fehlgeschlagen',
        body: `Refund ${refund.providerRefundId} für ${refund.payment.order.orderNumber} wurde von eBay abgelehnt (status=${ebayStatus}). Manuell prüfen.`,
        entityType: 'refund',
        entityId: refund.id,
        data: {
          kind: 'order_full',
          orderNumber: refund.payment.order.orderNumber,
          amount: Number(refund.amount),
          error: `eBay refund ${ebayStatus}`,
        },
      })
      .catch((e: any) =>
        this.logger.warn(`[ebay-refund-poll] notify failed: ${e?.message ?? e}`),
      )
  }

  private async checkFallback48h(refund: any): Promise<boolean> {
    // ebayRequestedAt may be NULL (if never set by provider); fall
    // back to refund.createdAt — Phase D documented decision.
    const requestedAt = refund.ebayRequestedAt ?? refund.createdAt
    const ageHours = (Date.now() - new Date(requestedAt).getTime()) / 3600000
    if (ageHours < FALLBACK_THRESHOLD_HOURS) return false

    // Has admin already been notified for this refund? Audit-log
    // existence check prevents double-notification spam.
    const existingNotice = await this.prisma.adminAuditLog.findFirst({
      where: { action: REFUND_AUDIT_ACTIONS.PENDING_48H, entityId: refund.id },
      select: { id: true },
    })
    if (existingNotice) return false

    await this.audit
      .log({
        adminId: 'system',
        action: REFUND_AUDIT_ACTIONS.PENDING_48H,
        entityType: 'refund',
        entityId: refund.id,
        changes: {
          after: {
            providerRefundId: refund.providerRefundId,
            orderNumber: refund.payment.order.orderNumber,
            ageHours: Math.floor(ageHours),
          },
        },
      })
      .catch(() => {})
    await this.notifications
      .createForAllAdmins({
        type: 'ebay_refund_pending_48h',
        title: 'eBay-Erstattung > 48h pending',
        body: `Refund ${refund.providerRefundId} für ${refund.payment.order.orderNumber} hängt seit >${Math.floor(ageHours)}h. Manuell prüfen.`,
        entityType: 'refund',
        entityId: refund.id,
        data: {
          orderNumber: refund.payment.order.orderNumber,
          ageHours: Math.floor(ageHours),
          providerRefundId: refund.providerRefundId,
        },
      })
      .catch((e: any) =>
        this.logger.warn(`[ebay-refund-poll] 48h-notify failed: ${e?.message ?? e}`),
      )
    return true
  }

  // Test-only: clear in-memory raw-logged tracker between tests
  __resetRawLoggedForTests(): void {
    this.rawLoggedOrderIds.clear()
  }
}
