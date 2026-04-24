/**
 * eBay Marketplace Account Deletion webhook controller.
 *
 * Public endpoint (no JwtAuthGuard). Signature on POST is our auth;
 * GET challenge is validated via shared-secret hash.
 *
 * Route: /api/v1/ebay/account-deletion (global /api/v1 prefix + this
 * controller's path). eBay Developer Portal needs the full URL with
 * scheme + prefix. That URL MUST also be set in
 * EBAY_MARKETPLACE_DELETION_ENDPOINT_URL — byte-for-byte match, since
 * the challenge-response hash includes the URL as input.
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
} from '@nestjs/common'
import type { Request } from 'express'
import { ApiTags, ApiOperation, ApiExcludeController } from '@nestjs/swagger'
import { EbayAccountDeletionService } from './ebay-account-deletion.service'

@ApiTags('eBay Webhooks')
@ApiExcludeController() // internal machine-to-machine, hide from admin Swagger
@Controller('ebay/account-deletion')
export class EbayAccountDeletionController {
  private readonly logger = new Logger(EbayAccountDeletionController.name)

  constructor(private readonly service: EbayAccountDeletionService) {}

  /**
   * GET challenge — eBay calls this once at registration AND periodically
   * to keep the endpoint alive. Must return 200 + JSON hash.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'eBay webhook — challenge verification (GET)' })
  challenge(@Query('challenge_code') challengeCode: string) {
    return this.service.handleChallenge(challengeCode)
  }

  /**
   * POST notification — real deletion event. Body needs raw-buffer
   * access for signature verification (rawBody: true is already active
   * in main.ts for Stripe/Klarna webhooks — reused here).
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'eBay webhook — account-deletion notification (POST)' })
  async notification(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-ebay-signature') signature: string,
  ) {
    if (!req.rawBody) {
      this.logger.error('eBay deletion webhook: missing raw body')
      return { received: false }
    }
    try {
      await this.service.handleNotification(req.rawBody, signature)
      return { received: true }
    } catch (e: any) {
      // Unauthorized/BadRequest exceptions bubble up to proper 4xx codes.
      // Unexpected errors also surface so eBay's retry machinery can do
      // its job.
      this.logger.error(`eBay deletion webhook failed: ${e?.message ?? e}`)
      throw e
    }
  }
}
