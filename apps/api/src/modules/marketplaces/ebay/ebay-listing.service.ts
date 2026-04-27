/**
 * eBay Listing Push Service (C11c).
 *
 * End-to-end publish-flow per listing:
 *   1. Load listing + product + variant + images + inventory + config
 *   2. Build Inventory-Item payload (throws on mapping-block errors
 *      like missing weight / images / ebay category)
 *   3. PUT /sell/inventory/v1/inventory_item/{sku}
 *   4. Build Offer payload
 *   5. Find-or-create Offer (GET by sku → PUT update if exists,
 *      POST create if not)
 *   6. If Offer not yet published: POST /offer/{offerId}/publish
 *   7. Persist externalListingId + status='active' + clear syncError
 *
 * Responsibilities OUT OF SCOPE (per user-confirmed C11c plan):
 *   - No delisting (C11.5)
 *   - No price / stock updates after initial publish (C15)
 *   - No auto-sync on product change (later commit)
 *   - No category-suggest API (C17 aspects extension)
 *
 * Concurrency:
 *   publishOne uses a conditional updateMany to claim the listing
 *   row atomically. Status 'pending' is flipped to 'active' at
 *   success — zero writes back into the row without a matching
 *   claim. Second concurrent Admin-click finds no pending row and
 *   no-ops.
 *
 * Failure taxonomy:
 *   - MappingBlockError        → status='rejected', syncError=code
 *                                (cannot be fixed without data repair)
 *   - EbayApiError status 4xx  → status='rejected', syncError=msg
 *   - EbayApiError status 5xx  → status stays 'pending' (retryable)
 *   - EbayApiError 429         → status stays 'pending' (rate-limit)
 *   - EbayNotConnectedError    → throws; bubble up; batch halts
 *   - Unknown/network           → status stays 'pending', syncError
 *                                holds the message
 *
 * Null-touch: only channel_product_listings is mutated. Product,
 * variant, inventory, order, payment tables are READ-ONLY for us.
 */

import { Injectable, Logger } from '@nestjs/common'
import type { ChannelListingStatus } from '@prisma/client'
import { PrismaService } from '../../../prisma/prisma.service'
import { EbayAuthService } from './ebay-auth.service'
import { EbayApiClient, EbayApiError, type FetchLike } from './ebay-api.client'
import { resolveEbayEnv } from './ebay-env'
import {
  buildInventoryItemPayload,
  buildOfferPayload,
  MappingBlockError,
  type MapperProduct,
  type MapperVariant,
  type MapperListing,
} from './ebay-listing-mapper'
import { AuditService } from '../../admin/services/audit.service'

// ──────────────────────────────────────────────────────────────
// Public result shapes
// ──────────────────────────────────────────────────────────────

export interface ToggleResult {
  productId: string
  enabled: boolean
  affectedVariants: number
}

export interface PublishOneResult {
  listingId: string
  ok: true
  externalListingId: string
  alreadyPublished: boolean
  marginWarning: boolean
}

export interface PublishOneFailure {
  listingId: string
  ok: false
  errorCode: string
  errorMessage: string
  retryable: boolean
}

export type PublishEntry = PublishOneResult | PublishOneFailure

export interface PublishPendingSummary {
  requested: number
  published: number
  failed: number
  remaining: number
  results: PublishEntry[]
}

// ──────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────

const PUBLISH_BATCH_DEFAULT = 25
const PUBLISH_BATCH_MAX = 100

// ──────────────────────────────────────────────────────────────
// Service
// ──────────────────────────────────────────────────────────────

@Injectable()
export class EbayListingService {
  private readonly logger = new Logger(EbayListingService.name)
  private fetchOverrideForTests: FetchLike | undefined

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: EbayAuthService,
    private readonly audit: AuditService,
  ) {}

  // ────────────────────────────────────────────────────────────
  // Public — read (admin UI surface)
  // ────────────────────────────────────────────────────────────

  /**
   * Admin-UI read shape: one row per variant of this product on the
   * eBay channel. Used by the product-editor section to render the
   * per-variant status (pending / active / rejected + syncError).
   */
  async listForProduct(productId: string): Promise<Array<{
    id: string
    variantId: string | null
    variantSku: string | null
    variantColor: string | null
    variantSize: string | null
    status: string
    externalListingId: string | null
    channelPrice: string | null
    safetyStock: number
    syncAttempts: number
    syncError: string | null
    lastSyncedAt: Date | null
  }>> {
    const rows = await this.prisma.channelProductListing.findMany({
      where: { productId, channel: 'ebay' },
      select: {
        id: true, variantId: true, status: true, externalListingId: true,
        channelPrice: true, safetyStock: true, syncAttempts: true,
        syncError: true, lastSyncedAt: true,
        variant: { select: { sku: true, color: true, size: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map((r) => ({
      id: r.id,
      variantId: r.variantId,
      variantSku: r.variant?.sku ?? null,
      variantColor: r.variant?.color ?? null,
      variantSize: r.variant?.size ?? null,
      status: r.status,
      externalListingId: r.externalListingId,
      channelPrice: r.channelPrice?.toString() ?? null,
      safetyStock: r.safetyStock,
      syncAttempts: r.syncAttempts,
      syncError: r.syncError,
      lastSyncedAt: r.lastSyncedAt,
    }))
  }

  /**
   * Count of pending eBay listings across all products — fuels the
   * "Publish Pending (N)" button badge in the connection card.
   */
  async countPending(): Promise<number> {
    return this.prisma.channelProductListing.count({
      where: { channel: 'ebay', status: 'pending' },
    })
  }

  // ────────────────────────────────────────────────────────────
  // Public — toggle
  // ────────────────────────────────────────────────────────────

  /**
   * Enable or disable eBay-listing intent for a product.
   *
   * ON  → for each ACTIVE variant: upsert row with status='pending'
   *        (revive 'deleted' rows, keep externalListingId history).
   * OFF → updateMany rows of this (product, ebay) to status='deleted'
   *        (does NOT touch eBay — actual unpublish comes in C11.5).
   *
   * Returns the count of variant-rows touched. Admin-UI surfaces
   * this so user understands the fan-out.
   */
  async toggleForProduct(
    productId: string,
    enabled: boolean,
    adminId: string,
    channelPrice?: string | null,
  ): Promise<ToggleResult> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        variants: { where: { isActive: true }, select: { id: true } },
      },
    })
    if (!product) {
      throw new MappingBlockError('product_not_found', `Product ${productId} not found`)
    }

    if (enabled) {
      // Fan-out to every active variant
      let affected = 0
      for (const v of product.variants) {
        await this.prisma.channelProductListing.upsert({
          where: {
            variantId_channel: { variantId: v.id, channel: 'ebay' },
          },
          create: {
            productId,
            variantId: v.id,
            channel: 'ebay',
            status: 'pending',
            channelPrice: channelPrice ?? null,
          },
          update: {
            status: 'pending',
            // Apply price if caller sent one; keep existing otherwise.
            ...(channelPrice !== undefined ? { channelPrice } : {}),
            // NOT resetting externalListingId / syncError — history
            // preserved for revives (same pattern as C4 transitions).
          },
        })
        affected++
      }

      await this.audit.log({
        adminId,
        action: 'EBAY_LISTING_ENABLED',
        entityType: 'product',
        entityId: productId,
        changes: {
          after: {
            enabled: true,
            variants: affected,
            channelPrice: channelPrice ?? null,
          },
        },
      })

      return { productId, enabled: true, affectedVariants: affected }
    }

    // Disable — soft delete all non-deleted rows
    const result = await this.prisma.channelProductListing.updateMany({
      where: {
        productId,
        channel: 'ebay',
        status: { not: 'deleted' },
      },
      data: { status: 'deleted' },
    })

    await this.audit.log({
      adminId,
      action: 'EBAY_LISTING_DISABLED',
      entityType: 'product',
      entityId: productId,
      changes: { after: { enabled: false, variants: result.count } },
    })

    return { productId, enabled: false, affectedVariants: result.count }
  }

  // ────────────────────────────────────────────────────────────
  // Public — bulk publish
  // ────────────────────────────────────────────────────────────

  /**
   * Publish all pending eBay listings, up to `batchLimit` per call.
   * Sequential to avoid eBay-side soft rate limits and to keep error
   * attribution clean. Returns a summary the admin UI can render.
   */
  async publishPending(
    adminId: string,
    batchLimit: number = PUBLISH_BATCH_DEFAULT,
  ): Promise<PublishPendingSummary> {
    const limit = Math.max(1, Math.min(batchLimit || PUBLISH_BATCH_DEFAULT, PUBLISH_BATCH_MAX))

    const pending = await this.prisma.channelProductListing.findMany({
      where: { channel: 'ebay', status: 'pending' },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    })

    const totalPendingCount = await this.prisma.channelProductListing.count({
      where: { channel: 'ebay', status: 'pending' },
    })

    const results: PublishEntry[] = []
    let published = 0
    let failed = 0

    for (const { id } of pending) {
      try {
        const result = await this.publishOne(id)
        results.push(result)
        // publishOne returns a PublishOneResult OR a PublishOneFailure;
        // only the success path counts toward `published`.
        if (result.ok) published++
        else failed++
      } catch (e: any) {
        // publishOne is supposed to never throw except for the
        // not-connected / revoked cases. Those must halt the batch
        // since every subsequent call would fail identically.
        if (e?.name === 'EbayNotConnectedError' || e?.name === 'EbayRefreshRevokedError') {
          throw e
        }
        // Defensive safety net if something did slip through.
        results.push({
          listingId: id,
          ok: false,
          errorCode: 'unknown_exception',
          errorMessage: String(e?.message ?? e).slice(0, 500),
          retryable: false,
        })
        failed++
      }
    }

    await this.audit.log({
      adminId,
      action: 'EBAY_PUBLISH_PENDING_BATCH',
      entityType: 'sales_channel_config',
      entityId: 'ebay',
      changes: {
        after: {
          batchLimit: limit,
          requested: pending.length,
          published,
          failed,
          remaining: Math.max(0, totalPendingCount - pending.length),
        },
      },
    })

    return {
      requested: pending.length,
      published,
      failed,
      remaining: Math.max(0, totalPendingCount - pending.length),
      results,
    }
  }

  // ────────────────────────────────────────────────────────────
  // Public — single publish. Used by publishPending + potentially
  // by admin UI for per-listing retry later.
  // ────────────────────────────────────────────────────────────

  /**
   * Publish exactly one listing row end-to-end. Returns either a
   * PublishOneResult (status flipped to active) or a PublishOneFailure
   * entry (row stays pending / rejected per taxonomy). Throws ONLY
   * for EbayNotConnectedError / EbayRefreshRevokedError — those halt
   * the whole batch.
   *
   * Concurrency-claim: the first conditional UPDATE serves as the
   * lock. We increment syncAttempts and mark lastSyncedAt
   * optimistically; if nothing gets updated, another process
   * already claimed the row and we exit cleanly.
   */
  async publishOne(listingId: string): Promise<PublishEntry> {
    // Step 1 — Concurrency claim: increment syncAttempts AT-LEAST-
    // ONCE for the claim to succeed. If another worker beat us to
    // the row, the WHERE clause matches zero rows (status moved
    // away from pending) and we no-op.
    const claim = await this.prisma.channelProductListing.updateMany({
      where: { id: listingId, status: 'pending', channel: 'ebay' },
      data: { syncAttempts: { increment: 1 }, lastSyncedAt: new Date() },
    })
    if (claim.count === 0) {
      // Either already published, deleted, or claimed by a racer.
      return {
        listingId,
        ok: false,
        errorCode: 'not_claimable',
        errorMessage: 'Listing is no longer pending — skipped',
        retryable: false,
      }
    }

    // Step 2 — Load full context
    const listingRow = await this.prisma.channelProductListing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        variantId: true,
        channelPrice: true,
        safetyStock: true,
        externalListingId: true,
      },
    })
    if (!listingRow || !listingRow.variantId) {
      return this.recordFail(
        listingId,
        'rejected',
        'listing_variant_missing',
        'Listing has no variantId',
        false,
      )
    }

    const variant = await this.prisma.productVariant.findUnique({
      where: { id: listingRow.variantId },
      select: {
        id: true,
        sku: true,
        barcode: true,
        color: true,
        size: true,
        priceModifier: true,
        weightGrams: true,
        productId: true,
      },
    })
    if (!variant) {
      return this.recordFail(
        listingId,
        'rejected',
        'variant_missing',
        'Variant not found',
        false,
      )
    }

    const product = await this.prisma.product.findUnique({
      where: { id: variant.productId },
      select: {
        id: true,
        slug: true,
        brand: true,
        basePrice: true,
        salePrice: true,
        category: {
          select: {
            ebayCategoryId: true,
            slug: true,
            parent: { select: { slug: true } },
          },
        },
        translations: {
          select: { language: true, name: true, description: true },
        },
        images: {
          select: {
            url: true,
            colorName: true,
            isPrimary: true,
            sortOrder: true,
          },
        },
      },
    })
    if (!product) {
      return this.recordFail(
        listingId,
        'rejected',
        'product_missing',
        'Product not found',
        false,
      )
    }

    const inventoryRows = await this.prisma.inventory.findMany({
      where: { variantId: variant.id },
      select: { quantityOnHand: true, quantityReserved: true },
    })

    // Step 3 — Pull policy-ids + merchant-location from settings
    const cfg = await this.prisma.salesChannelConfig.findUnique({
      where: { channel: 'ebay' },
      select: { settings: true },
    })
    const settings = (cfg?.settings ?? {}) as any
    const policyIds = settings?.policyIds
    const merchantLocationKey = settings?.merchantLocationKey
    if (
      !policyIds?.fulfillmentPolicyId ||
      !policyIds?.returnPolicyId ||
      !policyIds?.paymentPolicyId ||
      !merchantLocationKey
    ) {
      return this.recordFail(
        listingId,
        'rejected',
        'bootstrap_incomplete',
        'Run bootstrap-sandbox-policies first (missing policy IDs or merchant location)',
        false,
      )
    }

    // Step 4 — Build payloads (mapping can throw MappingBlockError)
    const mapperListing: MapperListing = {
      channelPrice: listingRow.channelPrice?.toString() ?? null,
      safetyStock: listingRow.safetyStock,
    }
    const mapperVariant: MapperVariant = {
      id: variant.id,
      sku: variant.sku,
      barcode: variant.barcode,
      color: variant.color,
      size: variant.size,
      priceModifier: variant.priceModifier.toString(),
      weightGrams: variant.weightGrams,
    }
    const mapperProduct: MapperProduct = {
      id: product.id,
      slug: product.slug,
      brand: product.brand,
      basePrice: product.basePrice.toString(),
      salePrice: product.salePrice?.toString() ?? null,
      category: product.category
        ? {
            ebayCategoryId: product.category.ebayCategoryId,
            // Top-level parent slug for Abteilung resolution.
            // For products under a top-level category directly (no parent),
            // fall back to the category's own slug.
            departmentSlug: product.category.parent?.slug ?? product.category.slug ?? null,
          }
        : null,
      translations: product.translations as MapperProduct['translations'],
      images: product.images,
    }

    let inventoryPayload
    let offerBuild
    try {
      inventoryPayload = buildInventoryItemPayload(
        mapperListing,
        mapperProduct,
        mapperVariant,
        inventoryRows,
      )
      offerBuild = buildOfferPayload({
        listing: mapperListing,
        product: mapperProduct,
        variant: mapperVariant,
        inventoryRows,
        policyIds,
        merchantLocationKey,
      })
    } catch (e) {
      if (e instanceof MappingBlockError) {
        return this.recordFail(listingId, 'rejected', e.code, e.message, false)
      }
      throw e
    }

    // Step 5 — Token + HTTP calls
    const token = await this.auth.getAccessTokenOrRefresh()
    const client = this.buildClient()

    // PUT inventory_item
    try {
      await client.request(
        'PUT',
        `/sell/inventory/v1/inventory_item/${encodeURIComponent(variant.sku)}`,
        {
          bearer: token,
          bodyKind: 'json',
          body: inventoryPayload as unknown as Record<string, unknown>,
        },
      )
    } catch (e) {
      return this.handleApiFailure(listingId, e, 'inventory_item_failed')
    }

    // Find or create Offer. eBay lists offers for a seller; we filter by SKU.
    let existingOfferId: string | null = null
    try {
      const offers = await client.request<{
        offers?: Array<{ offerId: string; marketplaceId: string; status: string }>
      }>(
        'GET',
        `/sell/inventory/v1/offer?sku=${encodeURIComponent(variant.sku)}&marketplace_id=EBAY_DE&limit=5`,
        { bearer: token },
      )
      const match = (offers.offers ?? []).find((o) => o.marketplaceId === 'EBAY_DE')
      if (match) existingOfferId = match.offerId
    } catch (e) {
      if (e instanceof EbayApiError && e.status === 404) {
        // No offers yet for this SKU — fall through to create.
      } else {
        return this.handleApiFailure(listingId, e, 'offer_lookup_failed')
      }
    }

    let offerId: string
    if (existingOfferId) {
      try {
        await client.request(
          'PUT',
          `/sell/inventory/v1/offer/${encodeURIComponent(existingOfferId)}`,
          {
            bearer: token,
            bodyKind: 'json',
            body: offerBuild.payload as unknown as Record<string, unknown>,
          },
        )
        offerId = existingOfferId
      } catch (e) {
        return this.handleApiFailure(listingId, e, 'offer_update_failed')
      }
    } else {
      try {
        const created = await client.request<{ offerId: string }>(
          'POST',
          `/sell/inventory/v1/offer`,
          {
            bearer: token,
            bodyKind: 'json',
            body: offerBuild.payload as unknown as Record<string, unknown>,
          },
        )
        if (!created.offerId) {
          return this.recordFail(
            listingId,
            'rejected',
            'offer_create_no_id',
            'eBay did not return offerId on create',
            false,
          )
        }
        offerId = created.offerId
      } catch (e) {
        return this.handleApiFailure(listingId, e, 'offer_create_failed')
      }
    }

    // POST publish
    let externalListingId: string | null = null
    let alreadyPublished = false
    try {
      const pub = await client.request<{ listingId?: string }>(
        'POST',
        `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
        { bearer: token, bodyKind: 'json', body: {} },
      )
      externalListingId = pub.listingId ?? null
    } catch (e) {
      // Bug B fix: eBay's errorId 25002 covers MANY sub-reasons —
      // "already published" is just one. The previous code treated
      // every 25002 as success, hiding real failures (BrandMPN missing,
      // Abteilung missing, …). Now we branch on the actual message.
      if (e instanceof EbayApiError && e.ebayErrors.some((x) => x.errorId === 25002)) {
        const ebay25002 = e.ebayErrors.find((x) => x.errorId === 25002)
        const firstMsg = (ebay25002?.message ?? '').trim()
        const longMsg  = (ebay25002?.longMessage ?? '').trim()
        const haystack = (firstMsg + ' | ' + longMsg).toLowerCase()
        // Match-list intentionally narrow (D-3 strategy): widen iteratively
        // when audit-log surfaces a new sub-phrase. Better fail-loud than
        // a false-positive "already published".
        const isAlreadyPublished =
          haystack.includes('already published') ||
          haystack.includes('bereits veröffentlicht')
        if (isAlreadyPublished) {
          alreadyPublished = true
        } else {
          // Real publish failure — preserve eBay's full error in syncError.
          const detailedMsg = `${firstMsg}${longMsg ? ' / ' + longMsg : ''}`.slice(0, 500)
          return this.recordFail(listingId, 'rejected', 'publish_rejected', detailedMsg, false)
        }
      } else {
        return this.handleApiFailure(listingId, e, 'publish_failed')
      }
    }

    if (!externalListingId && alreadyPublished) {
      // Lookup the existing listingId (publish already done previously).
      try {
        const offer = await client.request<{ listing?: { listingId?: string } }>(
          'GET',
          `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`,
          { bearer: token },
        )
        externalListingId = offer.listing?.listingId ?? null
      } catch {
        // Non-fatal — admin can re-check. Leave externalListingId null.
      }
    }

    // Bug A fix: never mark a row as 'active' without an externalListingId.
    // Reaching this branch means either the GET-fallback failed OR the
    // alreadyPublished claim was wrong. Either way the row is NOT live on
    // eBay — recordFail keeps the DB honest and surfaces the issue.
    if (!externalListingId) {
      return this.recordFail(
        listingId,
        'rejected',
        'no_listing_id_after_publish',
        `Publish accepted but eBay returned no listingId (alreadyPublished=${alreadyPublished})`,
        false,
      )
    }

    // Step 6 — Success persistence (externalListingId guaranteed non-null)
    await this.prisma.channelProductListing.update({
      where: { id: listingId },
      data: {
        status: 'active',
        externalListingId,
        syncError: null,
        lastSyncedAt: new Date(),
      },
    })

    await this.audit.log({
      adminId: 'system',
      action: 'EBAY_LISTING_PUBLISHED',
      entityType: 'channel_product_listing',
      entityId: listingId,
      changes: {
        after: {
          sku: variant.sku,
          externalListingId,
          alreadyPublished,
          offerId,
          marginWarning: offerBuild.price.hasMarginWarning,
          priceFallback: offerBuild.price.isFallback,
        },
      },
    })

    return {
      listingId,
      ok: true,
      externalListingId: externalListingId ?? '',
      alreadyPublished,
      marginWarning: offerBuild.price.hasMarginWarning,
    }
  }

  // ────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────

  private async handleApiFailure(
    listingId: string,
    err: unknown,
    errorCode: string,
  ): Promise<PublishOneFailure> {
    if (err instanceof EbayApiError) {
      const retryable = err.retryable
      // Retryable (5xx, 429, network) → keep pending (don't flip to rejected)
      // Non-retryable 4xx → rejected
      const nextStatus: ChannelListingStatus = retryable ? 'pending' : 'rejected'
      return this.recordFail(
        listingId,
        nextStatus,
        errorCode,
        err.message.slice(0, 500),
        retryable,
      )
    }
    // Unknown error → keep pending (safer than burying it) + syncError
    const anyErr = err as any
    return this.recordFail(
      listingId,
      'pending',
      `${errorCode}_unknown`,
      String(anyErr?.message ?? anyErr).slice(0, 500),
      true,
    )
  }

  private async recordFail(
    listingId: string,
    nextStatus: ChannelListingStatus,
    errorCode: string,
    errorMessage: string,
    retryable: boolean,
  ): Promise<PublishOneFailure> {
    try {
      await this.prisma.channelProductListing.update({
        where: { id: listingId },
        data: {
          status: nextStatus,
          syncError: `${errorCode}: ${errorMessage}`.slice(0, 500),
          lastSyncedAt: new Date(),
        },
      })
    } catch (dbErr: any) {
      // Listing row vanished mid-flight; record in audit but still
      // return the failure to the caller.
      this.logger.warn(`Failed to persist failure state for ${listingId}: ${dbErr?.message}`)
    }
    await this.audit.log({
      adminId: 'system',
      action: 'EBAY_LISTING_REJECTED',
      entityType: 'channel_product_listing',
      entityId: listingId,
      changes: {
        after: { errorCode, errorMessage, retryable, nextStatus },
      },
    })
    return { listingId, ok: false, errorCode, errorMessage, retryable }
  }

  private buildClient(): EbayApiClient {
    const env = resolveEbayEnv()
    return this.fetchOverrideForTests
      ? new EbayApiClient(env, this.fetchOverrideForTests)
      : new EbayApiClient(env)
  }

  __setFetchForTests(f: FetchLike | undefined): void {
    this.fetchOverrideForTests = f
  }
}
