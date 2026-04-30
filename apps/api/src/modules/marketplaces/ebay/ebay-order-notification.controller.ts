/**
 * eBay Order Notification webhook controller (C12.4).
 *
 * Public endpoint (no JwtAuthGuard). Authentication is the X-EBAY-
 * SIGNATURE header — verified inside the service via ECDSA against
 * eBay's public key.
 *
 * Route: /api/v1/ebay/order-notification (global /api/v1 prefix +
 * this controller's path). The same URL must be registered in eBay's
 * Developer Portal for the order-event topic subscription.
 *
 * GET handler — eBay calls this once at registration AND periodically
 * to keep the endpoint alive. Reuses the same challenge-hash scheme
 * as the account-deletion webhook, with its own verification token
 * + endpoint URL pair (independent rotation).
 *
 * POST handler — actual notification. Always answers 204 No Content
 * after the service finishes (per Q-7), regardless of business
 * outcome (imported / skipped / failed). Only signature/shape
 * failures bubble as 4xx, network/auth failures as 5xx — eBay's
 * retry machinery handles the rest.
 */

import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  RawBodyRequest,
  BadRequestException,
} from '@nestjs/common'
import type { Request } from 'express'
import { ApiTags, ApiOperation, ApiExcludeController } from '@nestjs/swagger'
import { createHash } from 'node:crypto'
import { EbayOrderNotificationService } from './ebay-order-notification.service'
import { MarketplaceNotificationAdapter } from '../adapters/marketplace-notification.adapter'

/**
 * C15.2 — First-Run-Logging counter for raw envelope shape.
 * Module-level so the count survives across requests within a process
 * lifetime; resets on deploy/restart. Mirrors the rawLoggedOrderIds
 * pattern from EbayShippingPushService (C14). Caps log volume after
 * the first 10 hits — that's enough to characterise the payload shape
 * for the planned multi-path parser.
 *
 * TODO(C15.4) — TEMPORARY DIAGNOSTIC LOGGING. Remove or harden when
 * the multi-path orderId parser lands:
 *   1. Once enough envelopes are captured (Railway logs grep
 *      '[ebay-order-webhook] raw envelope'), purge the captured
 *      lines from Railway log retention to minimise PII exposure.
 *   2. Then either:
 *      (a) Reduce slice(0, 3000) to slice(0, 200) — keeps shape-
 *          breadcrumb without the verbose PII payload, or
 *      (b) Replace this block with a PII-redacting logger that
 *          strips notification.data.{username, userId, eiasToken}
 *          before emit, or
 *      (c) Remove the block entirely if the parser is mature.
 *   3. Replace the ORDER_ID_MISSING_MARKER string-match in the
 *      catch with a dedicated typed Exception class — string-marker
 *      is refactor-fragile (owner-flagged in review).
 *
 * Reason: DSGVO Art. 4 — eBay payloads carry pseudonymised buyer
 * identifiers (username, userId, eiasToken). 10 envelopes during
 * the diagnostic window is acceptable (Railway-logs are private,
 * 30-day retention) but should NOT be the steady-state behaviour.
 *
 * Single-instance assumption: Railway runs apps/api as ONE replica
 * (railway.json has no numReplicas config). If the deployment is
 * ever scaled horizontally, the effective per-deploy log limit
 * becomes N × FIRST_RUN_LOG_LIMIT — known + accepted degradation.
 */
const FIRST_RUN_LOG_LIMIT = 10
let rawEnvelopeLogCount = 0

/**
 * C15.2 — Marker substring identifying the orderId-missing failure.
 * Centralised so the test pins the marker + the controller-side catch
 * use the exact same string. If the service-side error message ever
 * changes, the test breaks loudly (regression guard).
 */
export const ORDER_ID_MISSING_MARKER = 'notification.data.orderId missing'

@ApiTags('eBay Webhooks')
@ApiExcludeController()
@Controller('ebay/order-notification')
export class EbayOrderNotificationController {
  private readonly logger = new Logger(EbayOrderNotificationController.name)

  constructor(
    private readonly service: EbayOrderNotificationService,
    // C15.2 — admin-notify on unknown-payload-shape so we can capture
    // the real eBay envelope from the next live buyer event.
    private readonly notifyAdapter: MarketplaceNotificationAdapter,
  ) {}

  /**
   * GET challenge — same SHA-256(challengeCode + token + url) scheme
   * as the account-deletion endpoint, but with separate env vars so
   * the two webhooks rotate independently.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'eBay webhook — order notification challenge (GET)' })
  challenge(@Query('challenge_code') challengeCode: string) {
    if (!challengeCode) {
      throw new BadRequestException('challenge_code required')
    }
    const token = process.env.EBAY_ORDER_NOTIFICATION_VERIFICATION_TOKEN
    const endpoint = process.env.EBAY_ORDER_NOTIFICATION_ENDPOINT_URL
    if (!token || !endpoint) {
      this.logger.error('eBay order-notification webhook env not configured')
      throw new Error('EbayOrderNotificationWebhookNotConfigured')
    }
    const hash = createHash('sha256')
      .update(challengeCode + token + endpoint)
      .digest('hex')
    return { challengeResponse: hash }
  }

  /**
   * POST notification — order event. Body needs raw-buffer access for
   * signature verification. main.ts already enables rawBody on the
   * Nest app (used by Stripe / Klarna / account-deletion webhooks).
   *
   * Always 204 No Content on success per Q-7. EbayApiError +
   * EbayNotConnected etc. bubble as 5xx so eBay retries.
   */
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'eBay webhook — order notification (POST)' })
  async notification(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-ebay-signature') signature: string,
  ): Promise<void> {
    if (!req.rawBody) {
      this.logger.error('eBay order-notification webhook: missing raw body')
      // 400 — eBay should fix this on its side (not a transient error).
      throw new BadRequestException('missing raw body')
    }

    // C15.2 — First-Run-Logging of the raw envelope. The first 10
    // webhook hits after each deploy emit the full body (capped at
    // 3000 chars to keep Railway log-line limits comfortable). After
    // that, only the trailing summary log is emitted per request to
    // avoid log-bloat. Captures the actual eBay payload shape so the
    // multi-path orderId parser can be built on verified data, NOT
    // guesses (C15.2 owner-decision).
    if (rawEnvelopeLogCount < FIRST_RUN_LOG_LIMIT) {
      rawEnvelopeLogCount++
      const bodyStr = req.rawBody.toString('utf8').slice(0, 3000)
      this.logger.log(
        `[ebay-order-webhook] raw envelope #${rawEnvelopeLogCount}/${FIRST_RUN_LOG_LIMIT}: ${bodyStr}`,
      )
      // End-of-diagnostic marker — emitted exactly ONCE when the
      // counter hits the limit. Lets ops/admin grep Railway logs
      // for the diagnostic-phase boundary without manual counting.
      if (rawEnvelopeLogCount === FIRST_RUN_LOG_LIMIT) {
        this.logger.log(
          `[ebay-order-webhook] raw-body diagnostic logging disabled — ` +
            `limit reached, schema captured in ${FIRST_RUN_LOG_LIMIT} envelopes, ` +
            `ready for C15.4 (multi-path parser on verified data)`,
        )
      }
    }

    try {
      const outcome = await this.service.handleNotification(req.rawBody, signature)
      // Log structured outcome for observability; webhook still 204s.
      if (outcome) {
        this.logger.log(
          `[ebay-order-webhook] outcome=${outcome.status} importId=${outcome.importId ?? '-'}`,
        )
      } else {
        this.logger.log('[ebay-order-webhook] outcome=null (pre-import reject)')
      }
    } catch (e: any) {
      // C15.2 — Graceful degradation for unknown-payload-shape.
      //
      // When the service throws BadRequestException with the
      // ORDER_ID_MISSING_MARKER, the eBay payload-shape no longer
      // matches our parser (post-launch reality check on 2026-04-30
      // proved this happens with real buyer events). Three reasons
      // we MUST swallow this and answer 200 instead of bubbling 4xx:
      //   1. Pull-Cron (C12.5) imports the same order on its next
      //      15-min tick via getOrders() list-endpoint — verified live
      //      on 2026-04-30 (ORD-20260430-000001 imported successfully
      //      ~85 seconds after the webhook 400'd).
      //   2. Bubbling 4xx provokes eBay's retry storm: same body,
      //      same parser, same failure → 5× useless ERROR-log spam.
      //   3. Admin can't act on the failure without seeing the real
      //      envelope — which the new First-Run-Logging block above
      //      now persists in Railway logs.
      //
      // We DO NOT silently swallow — admin gets notified so the
      // payload can be inspected and the multi-path parser built on
      // verified data. We DO NOT extend the parser here ("nicht
      // raten" per owner spec).
      const msg = (e?.message ?? '').toString()
      const isUnknownPayloadShape =
        e instanceof BadRequestException && msg.includes(ORDER_ID_MISSING_MARKER)

      if (isUnknownPayloadShape) {
        this.logger.warn(
          `[ebay-order-webhook] unknown payload shape — pull-cron will recover. msg=${msg}`,
        )
        await this.notifyAdapter
          .notifyAdmins({
            type: 'ebay_webhook_payload_unknown_schema',
            data: {
              error: msg,
              hint: 'Real eBay payload differs from documented shape. Pull-Cron (C12.5) will import the order on next 15-min tick. Inspect Railway logs for "raw envelope" entries to see the actual structure, then extend the multi-path parser.',
            },
          })
          .catch((nerr: any) =>
            this.logger.warn(
              `[ebay-order-webhook] admin-notify failed: ${nerr?.message ?? nerr}`,
            ),
          )
        // 204 No Content — eBay does not retry, pull-cron handles it.
        return
      }

      // 4xx (UnauthorizedException for signature failures) and
      // 5xx-ish (EbayApiError, EbayNotConnected) still bubble —
      // those are retryable / require eBay-side fixes.
      this.logger.error(`eBay order-notification webhook failed: ${e?.message ?? e}`)
      throw e
    }
  }
}

// Test-only: reset the module-level counter between tests so
// First-Run-Logging assertions are deterministic.
export function __resetEbayWebhookLogCounterForTests(): void {
  rawEnvelopeLogCount = 0
}
