/**
 * EbayShippingPushService (C14).
 *
 * Pushes tracking information for an eBay-imported order to eBay's
 * shipping_fulfillment endpoint after the local shipment is created.
 * Without this, eBay buyers see "no tracking" on their eBay order
 * details page even though we've shipped, and the eBay seller-score
 * drops for every late tracking-upload.
 *
 * Architecture (Pfad α — fullShipment, decided in Phase A):
 *   POST /sell/fulfillment/v1/order/{channelOrderId}/shipping_fulfillment
 *   Body: { shippedDate, shippingCarrierCode, trackingNumber }
 *   No lineItems-Array (default — covers all line-items in one
 *   fulfillment). If eBay rejects with "lineItems required", First-Run-
 *   Logging surfaces it and Option γ (live-lookup via getOrder) becomes
 *   the deployable Sofort-Fallback.
 *
 * Two callers:
 *   - EbayShippingPushListener (fast-path, sync after shipment created)
 *   - EbayShippingPushCron (30-min retry-tick for failed pushes)
 *
 * Both call pushShipment(shipmentId) which is fully idempotent:
 *   - DB pre-check: if shipment.ebayPushedAt is non-null, skip
 *   - eBay 4xx "already registered" → mark as success
 *
 * Hard-rules:
 *   - shipments.service.createShipment() ZERO TOUCH
 *   - DHL provider / tracking-poll-cron ZERO TOUCH
 *   - Order/Payment/Invoice/Inventory ZERO TOUCH
 *   - Only column writes are: shipment.ebayPushedAt /
 *     ebayPushAttempts / ebayPushError (the C14.0 columns)
 */

import { Injectable, Logger } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { PrismaService } from '../../../prisma/prisma.service'
import { resolveEbayEnv } from './ebay-env'
import {
  EbayAuthService,
  EbayNotConnectedError,
  EbayRefreshRevokedError,
} from './ebay-auth.service'
import { EbayApiClient, EbayApiError } from './ebay-api.client'
import { AuditService } from '../../admin/services/audit.service'
import { NotificationService } from '../../admin/services/notification.service'

const MAX_PUSH_ATTEMPTS = 5

export const SHIPPING_AUDIT_ACTIONS = {
  PUSHED: 'EBAY_SHIPPING_PUSHED',
  FAILED: 'EBAY_SHIPPING_PUSH_FAILED',
} as const

// Carrier-code mapping: our ShipmentCarrier enum → eBay's
// shippingCarrierCode. Only DHL is live today; extend as new
// carriers are wired in. eBay rejects unknown carrier codes with
// 4xx — Phase E First-Run-Logging confirms the exact case.
const CARRIER_MAP: Record<string, string> = {
  dhl: 'DHL',
  // Future: dpd → 'DPD', hermes → 'Hermes', etc.
}

export interface PushResult {
  status: 'pushed' | 'already_pushed' | 'failed' | 'skipped_disconnected' | 'aborted_revoked' | 'skipped_no_tracking'
  shipmentId: string
  attempts: number
  error?: string
}

@Injectable()
export class EbayShippingPushService {
  private readonly logger = new Logger(EbayShippingPushService.name)

  // ModuleRef-based lazy resolution of EbayAuthService — same pattern
  // as EbayPaymentProvider hotfix (C13.3 commit 1195088). Avoids
  // module-load-time DI cycles by deferring resolution to runtime.
  // EbayAuthService lives in MarketplacesModule which we're in too,
  // so strict:false is overly defensive but keeps the pattern uniform.
  private cachedAuth: EbayAuthService | null = null

  // Tracks shipment-orders we've raw-logged in this process lifetime.
  // First-Run-Logging only — limits log noise after the first push.
  private readonly rawLoggedOrderIds = new Set<string>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleRef: ModuleRef,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  private async getAuth(): Promise<EbayAuthService> {
    if (this.cachedAuth) return this.cachedAuth
    const resolved = this.moduleRef.get(EbayAuthService, { strict: false })
    if (!resolved) {
      throw new Error('EbayShippingPushService: EbayAuthService not resolvable via ModuleRef')
    }
    this.cachedAuth = resolved
    return resolved
  }

  /**
   * Push a single shipment's tracking to eBay. Fully idempotent:
   * DB-pre-check (ebayPushedAt) and 4xx-already-registered detection
   * both prevent double-pushes.
   *
   * Returns a structured PushResult. Never throws on business outcomes
   * — only EbayNotConnected/Revoked bubble out via the result status.
   */
  async pushShipment(shipmentId: string): Promise<PushResult> {
    // 1. Load shipment with order relation
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        order: { select: { id: true, orderNumber: true, channel: true, channelOrderId: true } },
      },
    })
    if (!shipment) {
      return { status: 'failed', shipmentId, attempts: 0, error: 'shipment not found' }
    }

    // 2. Filter: only eBay-channel + has tracking
    if (shipment.order.channel !== 'ebay' || !shipment.order.channelOrderId) {
      return { status: 'skipped_no_tracking', shipmentId, attempts: shipment.ebayPushAttempts }
    }
    if (!shipment.trackingNumber) {
      return { status: 'skipped_no_tracking', shipmentId, attempts: shipment.ebayPushAttempts }
    }

    // 3. Idempotency pre-check
    if (shipment.ebayPushedAt) {
      return { status: 'already_pushed', shipmentId, attempts: shipment.ebayPushAttempts }
    }

    // 4. Pre-check eBay connection
    const config = await this.prisma.salesChannelConfig.findUnique({
      where: { channel: 'ebay' },
      select: { isActive: true, accessToken: true },
    })
    if (!config?.isActive || !config?.accessToken) {
      this.logger.warn(`[ebay-shipping-push] not connected — shipment=${shipmentId} skipped`)
      return { status: 'skipped_disconnected', shipmentId, attempts: shipment.ebayPushAttempts }
    }

    // 5. Get bearer
    let bearer: string
    try {
      const auth = await this.getAuth()
      bearer = await auth.getAccessTokenOrRefresh()
    } catch (e) {
      if (e instanceof EbayRefreshRevokedError) {
        this.logger.warn(`[ebay-shipping-push] aborted — refresh-token revoked`)
        return { status: 'aborted_revoked', shipmentId, attempts: shipment.ebayPushAttempts }
      }
      if (e instanceof EbayNotConnectedError) {
        this.logger.warn(`[ebay-shipping-push] not connected: ${e.message}`)
        return { status: 'skipped_disconnected', shipmentId, attempts: shipment.ebayPushAttempts }
      }
      throw e
    }

    // 6. Build payload
    const carrierCode = CARRIER_MAP[shipment.carrier] ?? shipment.carrier.toUpperCase()
    const shippedDateIso = (shipment.shippedAt ?? new Date()).toISOString()
    const body = {
      shippedDate: shippedDateIso,
      shippingCarrierCode: carrierCode,
      trackingNumber: shipment.trackingNumber,
    }

    // 7. Push via EbayApiClient
    const env = resolveEbayEnv()
    const client = new EbayApiClient(env)
    const orderId = shipment.order.channelOrderId
    let rawResponse: any = null
    let pushOk = false
    let pushError: string | null = null

    try {
      rawResponse = await client.request<any>(
        'POST',
        `/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}/shipping_fulfillment`,
        { bearer, body, bodyKind: 'json', retry: false },
      )
      pushOk = true
    } catch (e: any) {
      if (e instanceof EbayApiError) {
        // 4xx with "already registered" / "fulfillment exists" → idempotent
        // success. Defensive multi-message-keyword detection because eBay's
        // exact errorId for this case is not verified pre-deploy.
        const msg = (e.message ?? '').toLowerCase()
        const alreadyRegistered =
          e.status >= 400 && e.status < 500 &&
          (msg.includes('already') || msg.includes('exists') || msg.includes('duplicate'))
        if (alreadyRegistered) {
          this.logger.warn(
            `[ebay-shipping-push] eBay 4xx already-registered for shipment=${shipmentId} — treating as success`,
          )
          pushOk = true
          rawResponse = { idempotent: true, originalError: e.message }
        } else if (e.status >= 400 && e.status < 500) {
          // Other 4xx → permanent failure, log and persist error
          pushOk = false
          pushError = `eBay 4xx (${e.status}): ${e.message.slice(0, 300)}`
        } else {
          // 5xx → transient, will be retried by cron
          pushOk = false
          pushError = `eBay 5xx (${e.status}): ${e.message.slice(0, 300)}`
        }
      } else {
        // Network / unknown
        pushOk = false
        pushError = `network: ${(e?.message ?? String(e)).slice(0, 300)}`
      }
    }

    // 8. First-Run-Logging — full raw response/error per orderId, once
    if (!this.rawLoggedOrderIds.has(orderId)) {
      this.rawLoggedOrderIds.add(orderId)
      const summary = pushOk
        ? `OK: ${JSON.stringify(rawResponse).slice(0, 800)}`
        : `FAIL: ${pushError}`
      this.logger.log(
        `[ebay-shipping-push] first-run for order=${orderId}: ${summary}`,
      )
    }

    // 9. Persist outcome
    const newAttempts = shipment.ebayPushAttempts + 1
    if (pushOk) {
      await this.prisma.shipment.update({
        where: { id: shipmentId },
        data: {
          ebayPushedAt: new Date(),
          ebayPushAttempts: newAttempts,
          ebayPushError: null,
        },
      })
      this.logger.log(
        `[ebay-shipping-push] PUSHED shipment=${shipmentId} order=${shipment.order.orderNumber} tracking=${shipment.trackingNumber} carrier=${carrierCode}`,
      )
      await this.audit
        .log({
          adminId: 'system',
          action: SHIPPING_AUDIT_ACTIONS.PUSHED,
          entityType: 'shipment',
          entityId: shipmentId,
          changes: {
            after: {
              orderNumber: shipment.order.orderNumber,
              trackingNumber: shipment.trackingNumber,
              carrier: carrierCode,
              attempts: newAttempts,
            },
          },
        })
        .catch((e: any) =>
          this.logger.warn(`[ebay-shipping-push] audit log failed: ${e?.message ?? e}`),
        )
      return { status: 'pushed', shipmentId, attempts: newAttempts }
    }

    // Failed branch — persist error + maybe notify
    await this.prisma.shipment.update({
      where: { id: shipmentId },
      data: {
        ebayPushAttempts: newAttempts,
        ebayPushError: pushError ?? 'unknown error',
      },
    })

    const exhausted = newAttempts >= MAX_PUSH_ATTEMPTS
    if (exhausted) {
      this.logger.error(
        `[ebay-shipping-push] EXHAUSTED shipment=${shipmentId} order=${shipment.order.orderNumber} attempts=${newAttempts} error=${pushError}`,
      )
      await this.audit
        .log({
          adminId: 'system',
          action: SHIPPING_AUDIT_ACTIONS.FAILED,
          entityType: 'shipment',
          entityId: shipmentId,
          changes: {
            after: {
              orderNumber: shipment.order.orderNumber,
              trackingNumber: shipment.trackingNumber,
              attempts: newAttempts,
              error: pushError,
            },
          },
        })
        .catch(() => {})
      // Notify admin only on exhaustion (avoid spam during cron-retries)
      await this.notifications
        .createForAllAdmins({
          type: 'ebay_shipping_push_failed',
          title: 'eBay Tracking-Push fehlgeschlagen',
          body: `Tracking-Nummer ${shipment.trackingNumber} konnte nach ${newAttempts} Versuchen nicht zu eBay übertragen werden. Bestellung ${shipment.order.orderNumber}. Manuell im eBay Seller Hub eintragen.`,
          entityType: 'shipment',
          entityId: shipmentId,
          data: {
            orderNumber: shipment.order.orderNumber,
            trackingNumber: shipment.trackingNumber,
            attempts: newAttempts,
            error: pushError,
          },
        })
        .catch((e: any) =>
          this.logger.warn(`[ebay-shipping-push] notify failed: ${e?.message ?? e}`),
        )
    } else {
      this.logger.warn(
        `[ebay-shipping-push] FAILED (attempt ${newAttempts}/${MAX_PUSH_ATTEMPTS}) shipment=${shipmentId}: ${pushError}`,
      )
    }

    return { status: 'failed', shipmentId, attempts: newAttempts, error: pushError ?? undefined }
  }

  /**
   * Cron-callable: scan shipments needing push retry. Used by
   * EbayShippingPushCron with @SafeCron schedule (every 30 min).
   * Returns counts for cron-summary logging.
   */
  async retryFailedPushes(): Promise<{ scanned: number; pushed: number; stillFailed: number }> {
    const candidates = await this.prisma.shipment.findMany({
      where: {
        ebayPushedAt: null,
        ebayPushAttempts: { gt: 0, lt: MAX_PUSH_ATTEMPTS },
        trackingNumber: { not: null },
        order: { channel: 'ebay' as any, channelOrderId: { not: null } },
      },
      select: { id: true },
      take: 50,
      orderBy: { updatedAt: 'asc' },
    })

    let pushed = 0
    let stillFailed = 0
    for (const c of candidates) {
      const result = await this.pushShipment(c.id)
      if (result.status === 'pushed' || result.status === 'already_pushed') pushed++
      else if (result.status === 'failed') stillFailed++
    }
    if (candidates.length > 0) {
      this.logger.log(
        `[ebay-shipping-push] retry-tick scanned=${candidates.length} pushed=${pushed} stillFailed=${stillFailed}`,
      )
    }
    return { scanned: candidates.length, pushed, stillFailed }
  }

  // Test-only: clear in-memory raw-logged tracker between tests
  __resetRawLoggedForTests(): void {
    this.rawLoggedOrderIds.clear()
  }
}
