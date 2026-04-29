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

@ApiTags('eBay Webhooks')
@ApiExcludeController()
@Controller('ebay/order-notification')
export class EbayOrderNotificationController {
  private readonly logger = new Logger(EbayOrderNotificationController.name)

  constructor(private readonly service: EbayOrderNotificationService) {}

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
      // 4xx (UnauthorizedException, BadRequestException) bubble up
      // unchanged. 5xx-ish (EbayApiError, EbayNotConnected) also
      // bubble — controller does not transform business errors here.
      this.logger.error(`eBay order-notification webhook failed: ${e?.message ?? e}`)
      throw e
    }
  }
}
