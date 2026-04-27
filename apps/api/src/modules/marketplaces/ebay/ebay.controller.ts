/**
 * Admin controller for eBay connection + sandbox policies (C10).
 *
 * Endpoint surface (all under /admin/marketplaces/ebay):
 *
 *   GET   /status                      Connection + env probe (safe, never throws)
 *   POST  /connect                     Build the authorize-URL, return to UI
 *   GET   /oauth-callback              User-consent landing. Param: ?code=…&state=…
 *   POST  /disconnect                  Clear stored tokens + mark inactive
 *   POST  /bootstrap-sandbox-policies  Sandbox-only, idempotent policy creation
 *
 * Permission gate: SETTINGS_EDIT for every write endpoint + connect/
 * callback. Status is also behind SETTINGS_EDIT so we never leak the
 * presence/absence of eBay connection to unauthorised admins.
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Res,
  Req,
  UseGuards,
  Logger,
  BadRequestException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common'
import type { Response, Request } from 'express'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { PermissionGuard } from '../../../common/permissions/permission.guard'
import { RequirePermission } from '../../../common/permissions/require-permission.decorator'
import { PERMISSIONS } from '../../../common/permissions/permission.constants'
import { AuditService } from '../../admin/services/audit.service'
import {
  EbayAuthService,
  EbayNotConnectedError,
  EbayRefreshRevokedError,
} from './ebay-auth.service'
import { EbaySandboxPoliciesService } from './ebay-sandbox-policies.service'
import { EbayListingService } from './ebay-listing.service'
import { resolveEbayMode } from './ebay-env'
import { randomBytes } from 'node:crypto'
import { IsString, IsOptional, Matches, MaxLength, MinLength } from 'class-validator'

// In-memory state store for OAuth state tokens. Phase-2-only
// mechanism — low volume, single-admin-at-a-time, 10-minute TTL.
// For multi-replica deployments this would move to Redis, but
// Phase-2 is single-instance.
const stateStore = new Map<string, number>()
const STATE_TTL_MS = 10 * 60 * 1000

function storeState(token: string): void {
  stateStore.set(token, Date.now())
  // Cheap cleanup every call
  const now = Date.now()
  for (const [k, ts] of stateStore.entries()) {
    if (now - ts > STATE_TTL_MS) stateStore.delete(k)
  }
}

function consumeState(token: string): boolean {
  const ts = stateStore.get(token)
  if (!ts) return false
  stateStore.delete(token)
  return Date.now() - ts <= STATE_TTL_MS
}

// Sub-Task 1 (Production-Policies-UI): admin pastes the 3 policy
// IDs (and optional merchant-location-key) from the eBay Seller Hub
// into our settings JSON. Sandbox uses the bootstrap-service; this
// DTO is exclusively for the manual production path.
class SetPolicyIdsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  @Matches(/^\d+$/, { message: 'fulfillmentPolicyId must be numeric' })
  fulfillmentPolicyId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  @Matches(/^\d+$/, { message: 'returnPolicyId must be numeric' })
  returnPolicyId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  @Matches(/^\d+$/, { message: 'paymentPolicyId must be numeric' })
  paymentPolicyId!: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(36)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'merchantLocationKey must be alphanumeric/underscore/hyphen only',
  })
  merchantLocationKey?: string
}

// Guards are applied PER METHOD, not at the class level. The
// `oauth-callback` handler must stay public so eBay's own HTTP GET
// (unauthenticated from our side) can land — its legitimacy is
// proven by the single-use state token minted during /connect and
// consumed inside the callback. All other endpoints are guarded
// individually below, matching the pattern used in AuthController.
@Controller('admin/marketplaces/ebay')
export class EbayController {
  private readonly logger = new Logger(EbayController.name)

  constructor(
    private readonly auth: EbayAuthService,
    private readonly sandbox: EbaySandboxPoliciesService,
    private readonly audit: AuditService,
    private readonly listing: EbayListingService,
  ) {}

  @Get('status')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  async status() {
    return this.auth.getStatus()
  }

  @Post('connect')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  async connect(@Req() req: Request) {
    const token = randomBytes(32).toString('base64url')
    storeState(token)
    const url = this.auth.buildAuthorizeUrl(token)
    await this.audit.log({
      action: 'EBAY_OAUTH_CONNECT_INITIATED',
      entityType: 'sales_channel_config',
      entityId: 'ebay',
      adminId: (req as any).user?.id ?? 'system',
      changes: { after: { mode: resolveEbayMode() } },
    })
    return { url }
  }

  @Get('oauth-callback')
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    // NO permission guard on the callback itself — eBay (unauthenticated
    // from our side) issues a GET to this URL. We verify legitimacy via
    // the `state` token that was minted by /connect (which is gated).

    // Lazy-load the admin UI URL for redirect
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
    const successUrl = `${appUrl}/admin/channels?ebay=connected`
    const errorUrl = (code: string) => `${appUrl}/admin/channels?ebay=error&code=${code}`

    if (!state || !consumeState(state)) {
      await this.audit.log({
        action: 'EBAY_OAUTH_STATE_MISMATCH',
        entityType: 'sales_channel_config',
        entityId: 'ebay',
        adminId: 'system',
        changes: { after: { reason: 'state-missing-or-expired' } },
      })
      return res.redirect(errorUrl('state_mismatch'))
    }

    try {
      const result = await this.auth.handleCallback(code, state)
      await this.audit.log({
        action: 'EBAY_OAUTH_CONNECTED',
        entityType: 'sales_channel_config',
        entityId: 'ebay',
        adminId: 'system',
        changes: {
          after: {
            mode: resolveEbayMode(),
            tokenExpiresAt: result.tokenExpiresAt.toISOString(),
            refreshTokenExpiresAt: result.refreshTokenExpiresAt.toISOString(),
          },
        },
      })
      return res.redirect(successUrl)
    } catch (e: any) {
      this.logger.error(`OAuth callback failure: ${e?.message ?? e}`)
      await this.audit.log({
        action: 'EBAY_OAUTH_CALLBACK_FAILED',
        entityType: 'sales_channel_config',
        entityId: 'ebay',
        adminId: 'system',
        changes: { after: { error: String(e?.message ?? e).slice(0, 300) } },
      })
      return res.redirect(errorUrl('callback_failed'))
    }
  }

  @Post('disconnect')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  async disconnect(@Req() req: Request) {
    await this.auth.disconnect()
    await this.audit.log({
      action: 'EBAY_OAUTH_DISCONNECTED',
      entityType: 'sales_channel_config',
      entityId: 'ebay',
      adminId: (req as any).user?.id ?? 'system',
    })
    return { ok: true }
  }

  @Post('bootstrap-sandbox-policies')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  async bootstrapSandboxPolicies(@Req() req: Request) {
    try {
      const result = await this.sandbox.bootstrapPolicies()
      await this.audit.log({
        action: 'EBAY_SANDBOX_POLICIES_BOOTSTRAPPED',
        entityType: 'sales_channel_config',
        entityId: 'ebay',
        adminId: (req as any).user?.id ?? 'system',
        changes: {
          after: {
            fulfillmentPolicyId: result.fulfillmentPolicyId,
            returnPolicyId: result.returnPolicyId,
            paymentPolicyId: result.paymentPolicyId,
            alreadyExisted: result.alreadyExisted,
            programOptIn: result.programOptIn,
            merchantLocation: result.merchantLocation,
          },
        },
      })
      return result
    } catch (e: any) {
      if (e instanceof EbayNotConnectedError || e instanceof EbayRefreshRevokedError) {
        // Translate to HTTP 403 with 3-lang message. MUST throw so the
        // framework emits an actual 4xx response — returning an envelope
        // lets the browser see HTTP 200 and fire onSuccess with a false
        // "success" banner.
        throw new ForbiddenException({
          error: e.code,
          message: e.message3,
        })
      }
      // Special-case the 24h propagation delay after a FRESH opt-in.
      // eBay returns "User is not eligible for Business Policy" even
      // though our opt-in call succeeded — the account-side enrolment
      // takes up to 24 hours to propagate through their internal
      // pipeline. Give the admin a clear, actionable message instead
      // of the raw eBay error.
      if (this.isBusinessPolicyNotEligibleError(e)) {
        // HTTP 425 "Too Early" — semantically correct signal that the
        // account-side enrolment is still propagating through eBay's
        // internal pipeline. Must throw (not return) so the browser
        // sees a real 4xx status and the mutation fires onError.
        throw new HttpException(
          {
            error: 'EBAY_PROGRAM_OPT_IN_PROPAGATING',
            message: {
              de: 'Die eBay-Programm-Aktivierung wurde angenommen, ist aber noch nicht vollständig verarbeitet. eBay braucht dafür bis zu 24 Stunden. Bitte klicke in 1-24 Stunden erneut auf "Sandbox-Policies anlegen".',
              en: 'Your eBay program opt-in was accepted but has not finished propagating yet. eBay needs up to 24 hours for this. Please click "Bootstrap sandbox policies" again in 1-24 hours.',
              ar: 'تم قبول اشتراك برنامج eBay ولكنه لم يكتمل بعد. قد تحتاج eBay إلى 24 ساعة لذلك. يرجى النقر على "إعداد سياسات Sandbox" مرة أخرى خلال 1-24 ساعة.',
            },
          },
          425,
        )
      }
      throw e
    }
  }

  /**
   * Sub-Task 1 (Production-Policies-UI): admin manually pastes the 3
   * production policy IDs (created via Seller Hub) into our settings
   * JSON. Sandbox keeps the bootstrap-service; this is the production
   * counterpart per the C10 user-decision (no API-write to production
   * seller account).
   *
   * Optional merchantLocationKey: Sub-Task 2 will fill this via the
   * production merchant-location service, but admins may also paste
   * it here for manual control.
   */
  @Post('policy-ids')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  async setPolicyIds(@Body() dto: SetPolicyIdsDto, @Req() req: Request) {
    const adminId = (req as any).user?.id ?? 'system'
    const ipAddress = req.ip
    const patch: Record<string, unknown> = {
      policyIds: {
        fulfillmentPolicyId: dto.fulfillmentPolicyId,
        returnPolicyId: dto.returnPolicyId,
        paymentPolicyId: dto.paymentPolicyId,
      },
    }
    if (dto.merchantLocationKey) {
      patch.merchantLocationKey = dto.merchantLocationKey
    }
    await this.auth.patchSettings(patch)
    await this.audit
      .log({
        adminId,
        action: 'EBAY_POLICY_IDS_UPDATED',
        entityType: 'sales_channel_config',
        entityId: 'ebay',
        ipAddress,
        changes: { after: patch },
      })
      .catch(() => {
        /* audit must never block business success */
      })
    return { ok: true }
  }

  /**
   * Detects the "User is not eligible for Business Policy" error
   * that eBay returns during the 24-hour opt-in propagation window.
   * Based on eBay documented and observed response shapes:
   *   HTTP 403 with a message mentioning "eligible" / "Business Policy"
   *   Error id 20403 (documented eligibility error)
   *   Or the plain message includes "not eligible"
   */
  private isBusinessPolicyNotEligibleError(e: any): boolean {
    if (!e || typeof e !== 'object') return false
    // Raw EbayApiError shape carries ebayErrors array + rawBody.
    const ebayErrs: any[] = Array.isArray(e.ebayErrors) ? e.ebayErrors : []
    if (ebayErrs.some((x) => x?.errorId === 20403)) return true
    const msg = String(e.message ?? '').toLowerCase()
    if (msg.includes('not eligible') && msg.includes('business policy')) return true
    const raw = String(e.rawBody ?? '').toLowerCase()
    if (raw.includes('not eligible') && raw.includes('business policy')) return true
    return false
  }

  // ────────────────────────────────────────────────────────────
  // C11c — Listing publishing
  // ────────────────────────────────────────────────────────────

  /**
   * Read-endpoint for the Admin product editor. Returns one entry
   * per variant of this product with its eBay listing state.
   */
  @Get('listings')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  async getListingsForProduct(@Query('productId') productId?: string) {
    if (!productId || typeof productId !== 'string') {
      throw new BadRequestException({
        code: 'EBAY_LISTINGS_MISSING_PRODUCT_ID',
        message: { de: 'productId Query-Parameter erforderlich.', en: 'productId query param required.', ar: 'productId مطلوب.' },
      })
    }
    const rows = await this.listing.listForProduct(productId)
    return { rows }
  }

  /** Count of pending eBay listings (fuels the "Publish (N)" badge). */
  @Get('pending-count')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  async getPendingCount() {
    const count = await this.listing.countPending()
    return { count }
  }

  /**
   * Toggle eBay listing intent for a product.
   * Body: { productId: string, enabled: boolean, channelPrice?: string | null }
   * When enabled=true we upsert one ChannelProductListing row per
   * active variant with status='pending'. When enabled=false we
   * soft-delete all rows of this product (eBay-side unpublish is
   * handled in C11.5 — the admin UI surfaces a clear warning).
   */
  @Post('toggle-listing')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  async toggleListing(
    @Body() body: { productId?: string; enabled?: boolean; channelPrice?: string | null },
    @Req() req: Request,
  ) {
    if (!body?.productId || typeof body.productId !== 'string') {
      throw new BadRequestException({
        code: 'EBAY_TOGGLE_MISSING_PRODUCT_ID',
        message: {
          de: 'productId ist erforderlich.',
          en: 'productId is required.',
          ar: 'productId مطلوب.',
        },
      })
    }
    if (typeof body.enabled !== 'boolean') {
      throw new BadRequestException({
        code: 'EBAY_TOGGLE_MISSING_ENABLED',
        message: {
          de: 'Das Feld "enabled" muss true oder false sein.',
          en: 'Field "enabled" must be true or false.',
          ar: 'يجب أن تكون قيمة "enabled" true أو false.',
        },
      })
    }
    const adminId = (req as any).user?.id ?? 'system'
    try {
      return await this.listing.toggleForProduct(
        body.productId,
        body.enabled,
        adminId,
        body.channelPrice ?? null,
      )
    } catch (e: any) {
      if (e?.code === 'product_not_found') {
        throw new BadRequestException({
          code: 'EBAY_TOGGLE_PRODUCT_NOT_FOUND',
          message: {
            de: 'Produkt nicht gefunden.',
            en: 'Product not found.',
            ar: 'المنتج غير موجود.',
          },
        })
      }
      throw e
    }
  }

  /**
   * Bulk-publish all pending eBay listings (up to `batchLimit`,
   * default 25, hard-capped at 100 to avoid browser-timeout).
   * Sequential to respect rate limits and keep error attribution
   * clean. Response returns per-listing details + summary counts.
   */
  @Post('publish-pending')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  async publishPending(
    @Body() body: { batchLimit?: number },
    @Req() req: Request,
  ) {
    const adminId = (req as any).user?.id ?? 'system'
    try {
      return await this.listing.publishPending(adminId, body?.batchLimit)
    } catch (e: any) {
      // Token-level failures halt the batch entirely and must reach the admin.
      // MUST throw (not return) so the browser sees a real 4xx and the
      // mutation fires onError instead of onSuccess with a fake envelope.
      if (e instanceof EbayNotConnectedError || e instanceof EbayRefreshRevokedError) {
        throw new ForbiddenException({
          error: e.code,
          message: e.message3,
        })
      }
      throw e
    }
  }
}
