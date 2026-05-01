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

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common'
import type { ChannelListingStatus } from '@prisma/client'
import { PrismaService } from '../../../prisma/prisma.service'
import { EbayAuthService } from './ebay-auth.service'
import { EbayApiClient, EbayApiError, type FetchLike } from './ebay-api.client'
import { resolveEbayEnv } from './ebay-env'
import {
  buildInventoryItemPayload,
  buildOfferPayload,
  MappingBlockError,
  buildInventoryItemGroupKey,
  buildInventoryItemGroupPayload,
  resolveDepartment,
  type MapperProduct,
  type MapperVariant,
  type MapperListing,
  type InventoryItemGroupPayload,
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

// ──────────────────────────────────────────────────────────────
// Multi-Variation Publish Result (C11.6)
// ──────────────────────────────────────────────────────────────
//
// publishProduct returns this discriminated union. publishPending
// internally wraps the per-product results back into PublishEntry
// for backwards-compatibility with the frontend (which renders a
// per-row card with `listingId` as React-key).
export type PublishProductResult =
  | {
      ok: true
      productId: string
      externalListingId: string
      variantCount: number
      groupKey?: string
      mode: 'single' | 'group'
    }
  | {
      ok: false
      productId: string
      errorCode: string
      errorMessage: string
      retryable: boolean
      mode: 'single' | 'group' | 'unknown'
    }

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
  // Public — admin reset (C15.4)
  // ────────────────────────────────────────────────────────────

  /**
   * C15.4 — Admin-only reset for an eBay listing whose stock-push got
   * stuck (exhausted MAX_PUSH_ATTEMPTS, paused for sync_error, or paused
   * manually). Resets the sync-state and flips status='active' so the
   * next reconcile-cron-tick picks it up again.
   *
   * Caller must have SETTINGS_EDIT permission (enforced in controller).
   * Audit-row written (CHANNEL_LISTING_SYNC_RESET, operational tier).
   *
   * Guards:
   *   - Listing must exist and be channel='ebay'.
   *   - Listing must NOT be in terminal state ('deleted' or 'rejected') —
   *     those require explicit re-publish via toggleForProduct, not a reset.
   *
   * Idempotency: a listing already in status='active' with attempts=0 is
   * a no-op write (same data) but still produces an audit-row for trail.
   */
  async resetListingSync(
    listingId: string,
    adminId: string,
    ipAddress?: string,
  ): Promise<{
    id: string
    previousStatus: string
    previousAttempts: number
    previousSyncError: string | null
    newStatus: 'active'
    newAttempts: 0
  }> {
    const row = await this.prisma.channelProductListing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        channel: true,
        status: true,
        syncAttempts: true,
        syncError: true,
        pauseReason: true,
      },
    })
    if (!row) {
      throw new NotFoundException({
        error: 'ListingNotFound',
        message: {
          de: `Channel-Listing ${listingId} nicht gefunden`,
          en: `Channel listing ${listingId} not found`,
          ar: `قائمة القناة ${listingId} غير موجودة`,
        },
      })
    }
    if (row.channel !== 'ebay') {
      throw new BadRequestException({
        error: 'WrongChannel',
        message: {
          de: 'Reset-Sync ist nur für eBay-Listings verfügbar',
          en: 'reset-sync is only available for eBay listings',
          ar: 'إعادة ضبط المزامنة متاحة فقط لقوائم eBay',
        },
        data: { actualChannel: row.channel },
      })
    }
    if (row.status === 'deleted' || row.status === 'rejected') {
      throw new BadRequestException({
        error: 'ListingInTerminalState',
        message: {
          de: `Listing ist in Status '${row.status}' — Reset nicht möglich. Re-Publish über die Produkt-Bearbeitung erforderlich.`,
          en: `Listing is in status '${row.status}' — reset not allowed. Re-publish via product editor required.`,
          ar: `القائمة في حالة '${row.status}' — لا يمكن إعادة الضبط. مطلوب إعادة النشر عبر محرر المنتج.`,
        },
        data: { currentStatus: row.status },
      })
    }

    const previousStatus = row.status
    const previousAttempts = row.syncAttempts
    const previousSyncError = row.syncError
    const previousPauseReason = row.pauseReason

    await this.prisma.channelProductListing.update({
      where: { id: listingId },
      data: {
        status: 'active',
        syncAttempts: 0,
        syncError: null,
        pauseReason: null,
      },
    })

    await this.audit.log({
      adminId,
      action: 'CHANNEL_LISTING_SYNC_RESET',
      entityType: 'channel_product_listing',
      entityId: listingId,
      ipAddress,
      changes: {
        before: {
          status: previousStatus,
          syncAttempts: previousAttempts,
          syncError: previousSyncError,
          pauseReason: previousPauseReason,
        },
        after: {
          status: 'active',
          syncAttempts: 0,
          syncError: null,
          pauseReason: null,
        },
      },
    })

    return {
      id: listingId,
      previousStatus,
      previousAttempts,
      previousSyncError,
      newStatus: 'active',
      newAttempts: 0,
    }
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

    // C11.6 — Group-by-productId: iterate distinct productIds in
    // oldest-first order. batchLimit semantics changed from "max N
    // variants" to "max N products". For our scale (12-30 variants
    // per product) the default 25 products = up to ~750 variants.
    const pendingProductRows = await this.prisma.channelProductListing.findMany({
      where: { channel: 'ebay', status: 'pending' },
      select: { productId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
    const distinctProductIds: string[] = []
    const seen = new Set<string>()
    for (const row of pendingProductRows) {
      if (!seen.has(row.productId)) {
        distinctProductIds.push(row.productId)
        seen.add(row.productId)
        if (distinctProductIds.length >= limit) break
      }
    }

    const productResults: PublishProductResult[] = []
    let published = 0
    let failed = 0

    for (const productId of distinctProductIds) {
      try {
        const result = await this.publishProduct(productId)
        productResults.push(result)
        if (result.ok) published++
        else failed++
      } catch (e: any) {
        // publishProduct is supposed to never throw except for the
        // not-connected / revoked cases. Those halt the batch since
        // every subsequent call would fail identically.
        if (e?.name === 'EbayNotConnectedError' || e?.name === 'EbayRefreshRevokedError') {
          throw e
        }
        productResults.push({
          ok: false,
          productId,
          mode: 'unknown',
          errorCode: 'unknown_exception',
          errorMessage: String(e?.message ?? e).slice(0, 500),
          retryable: false,
        })
        failed++
      }
    }

    // Backward-compat: frontend renders a per-row card with `listingId`
    // as React-key. Map per-product results to PublishEntry shape using
    // productId as the key. The externalListingId is now group-level
    // (same value across all variants of one product) — frontend shows
    // it once per product, which is semantically correct.
    const results: PublishEntry[] = productResults.map((r) =>
      r.ok
        ? {
            listingId: r.productId,
            ok: true,
            externalListingId: r.externalListingId,
            alreadyPublished: false,
            marginWarning: false,
          }
        : {
            listingId: r.productId,
            ok: false,
            errorCode: r.errorCode,
            errorMessage: r.errorMessage,
            retryable: r.retryable,
          },
    )

    // Recompute remaining as variant-count (frontend's expectation)
    // rather than product-count — preserves the existing semantics.
    const remainingVariantRows = await this.prisma.channelProductListing.count({
      where: { channel: 'ebay', status: 'pending' },
    })

    await this.audit.log({
      adminId,
      action: 'EBAY_PUBLISH_PENDING_BATCH',
      entityType: 'sales_channel_config',
      entityId: 'ebay',
      changes: {
        after: {
          batchLimit: limit,
          requested: distinctProductIds.length,
          published,
          failed,
          remaining: remainingVariantRows,
        },
      },
    })

    return {
      requested: distinctProductIds.length,
      published,
      failed,
      remaining: remainingVariantRows,
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

    // Step 6 — Success persistence (externalListingId guaranteed non-null).
    // C15.4: persist externalOfferId next to externalListingId. Stock-push
    // (bulk_update_price_quantity) requires the offerId, NOT the listingId.
    // Both branches above (fresh publish via Zeile 712 + alreadyPublished
    // GET-fallback via Zeile 741-753) flow through here with offerId
    // already known from Zeile 661/673/697.
    await this.prisma.channelProductListing.update({
      where: { id: listingId },
      data: {
        status: 'active',
        externalListingId,
        externalOfferId: offerId,
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
  // Public — multi-variation product publish (C11.6)
  // ────────────────────────────────────────────────────────────

  /**
   * Publish a complete product (all its active variants) to eBay.
   *
   * Routing logic:
   *   - 0 active variants → recordProductFail('no_active_variants')
   *   - 1 active variant → delegates to publishOne (Single-Variant path,
   *     existing C11c flow unchanged)
   *   - 2+ active variants → multi-variation group path (10 steps)
   *
   * Multi-Variation Group Path (10 steps):
   *
   *   Pre-tx:
   *     1. Multi-Row claim — atomic updateMany on all pending rows of
   *        this productId. If claim.count !== expectedVariantCount,
   *        recordProductFail('partial_pending').
   *
   *     2. Load context — product + N active variants + N inventories +
   *        N channel-prices.
   *
   *     3. Pull policies + merchant-location-key.
   *
   *     4. Pre-flight build (Q-16 STRICT validation):
   *          - buildInventoryItemGroupPayload  (group body)
   *          - buildInventoryItemPayload × N   (per-variant item bodies)
   *          - buildOfferPayload × N            (per-variant offer bodies)
   *        Any MappingBlockError → recordFail for ALL N rows with same
   *        syncError.
   *
   *   eBay HTTP calls (sequential per Q-D1):
   *     5. PUT /sell/inventory/v1/inventory_item/{sku}    × N variants
   *     6. GET offer?sku + POST/PUT offer (DRAFT)         × N
   *     7. PUT /sell/inventory/v1/inventory_item_group/{groupKey}
   *     8. POST /sell/inventory/v1/offer/publish_by_inventory_item_group
   *        body: { inventoryItemGroupKey, marketplaceId: 'EBAY_DE' }
   *        → response.listingId  (single listing ID for whole group)
   *
   *   Persistence:
   *     9. Multi-Row updateMany — all N rows: status='active',
   *        externalListingId=<groupListingId>, syncError=null.
   *
   *    10. Audit log entry: EBAY_PRODUCT_GROUP_PUBLISHED.
   *
   * Throws ONLY for EbayNotConnectedError / EbayRefreshRevokedError.
   *
   * Concurrency: Step 1's atomic updateMany is the lock. A racing
   * publishProduct(same productId) finds claim.count=0 and returns
   * 'not_claimable'.
   */
  async publishProduct(productId: string): Promise<PublishProductResult> {
    // Step 0 — Routing
    const activeVariantCount = await this.prisma.productVariant.count({
      where: { productId, isActive: true },
    })
    if (activeVariantCount === 0) {
      return await this.recordProductFail(
        productId, 'rejected', 'no_active_variants',
        `Product ${productId} has no active variants`, false, 'unknown',
      )
    }
    if (activeVariantCount === 1) {
      return await this.publishProductSingleVariant(productId)
    }
    return await this.publishProductGroup(productId, activeVariantCount)
  }

  private async publishProductSingleVariant(productId: string): Promise<PublishProductResult> {
    const row = await this.prisma.channelProductListing.findFirst({
      where: { productId, channel: 'ebay', status: 'pending' },
      select: { id: true },
    })
    if (!row) {
      return {
        ok: false, productId, mode: 'single',
        errorCode: 'no_pending_row',
        errorMessage: 'No pending row for this product (1-variant case)',
        retryable: false,
      }
    }
    const result = await this.publishOne(row.id)
    if (result.ok) {
      return {
        ok: true, productId, mode: 'single',
        externalListingId: result.externalListingId,
        variantCount: 1,
      }
    }
    return {
      ok: false, productId, mode: 'single',
      errorCode: result.errorCode, errorMessage: result.errorMessage, retryable: result.retryable,
    }
  }

  private async publishProductGroup(
    productId: string,
    expectedVariantCount: number,
  ): Promise<PublishProductResult> {
    // Step 1 — Multi-Row Concurrency claim (Q-D2)
    const claim = await this.prisma.channelProductListing.updateMany({
      where: { productId, channel: 'ebay', status: 'pending' },
      data: { syncAttempts: { increment: 1 }, lastSyncedAt: new Date() },
    })
    if (claim.count === 0) {
      return {
        ok: false, productId, mode: 'group',
        errorCode: 'not_claimable',
        errorMessage: 'No pending rows — already published or claimed by racer',
        retryable: false,
      }
    }
    if (claim.count !== expectedVariantCount) {
      return await this.recordProductFail(
        productId, 'rejected', 'partial_pending',
        `Group needs ALL ${expectedVariantCount} variants in pending state, got ${claim.count}`,
        false, 'group',
      )
    }

    // Step 2 — Load context
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true, slug: true, brand: true, basePrice: true, salePrice: true,
        category: { select: { ebayCategoryId: true, slug: true, parent: { select: { slug: true } } } },
        translations: { select: { language: true, name: true, description: true } },
        images: { select: { url: true, colorName: true, isPrimary: true, sortOrder: true } },
      },
    })
    if (!product) {
      return await this.recordProductFail(productId, 'rejected', 'product_missing', 'Product not found', false, 'group')
    }
    const variants = await this.prisma.productVariant.findMany({
      where: { productId, isActive: true },
      select: { id: true, sku: true, barcode: true, color: true, size: true, priceModifier: true, weightGrams: true },
    })
    const inventoryRows = await this.prisma.inventory.findMany({
      where: { variantId: { in: variants.map(v => v.id) } },
      select: { variantId: true, quantityOnHand: true, quantityReserved: true },
    })
    const inventoryByVariant = new Map<string, Array<{ quantityOnHand: number; quantityReserved: number }>>()
    for (const inv of inventoryRows) {
      if (!inv.variantId) continue
      const list = inventoryByVariant.get(inv.variantId) ?? []
      list.push({ quantityOnHand: inv.quantityOnHand, quantityReserved: inv.quantityReserved })
      inventoryByVariant.set(inv.variantId, list)
    }
    const listingRows = await this.prisma.channelProductListing.findMany({
      where: { productId, channel: 'ebay' },
      select: { variantId: true, channelPrice: true, safetyStock: true },
    })
    const listingByVariant = new Map<string, { channelPrice: string | null; safetyStock: number }>()
    for (const lr of listingRows) {
      if (!lr.variantId) continue
      listingByVariant.set(lr.variantId, {
        channelPrice: lr.channelPrice?.toString() ?? null,
        safetyStock: lr.safetyStock,
      })
    }

    // Step 3 — Policies + merchantLocationKey
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
      return await this.recordProductFail(
        productId, 'rejected', 'bootstrap_incomplete',
        'Run bootstrap-sandbox-policies first (missing policy IDs or merchant location)',
        false, 'group',
      )
    }

    // Step 4 — Pre-flight build (Q-16)
    const groupKey = buildInventoryItemGroupKey(productId)
    const departmentSlug = product.category?.parent?.slug ?? product.category?.slug ?? null
    const department = resolveDepartment(departmentSlug)
    if (!department) {
      return await this.recordProductFail(
        productId, 'rejected', 'department_unmapped',
        `Cannot resolve department from category slug=${departmentSlug ?? 'null'}`,
        false, 'group',
      )
    }

    const mapperProduct: MapperProduct = {
      id: product.id, slug: product.slug, brand: product.brand,
      basePrice: product.basePrice.toString(),
      salePrice: product.salePrice?.toString() ?? null,
      category: product.category
        ? { ebayCategoryId: product.category.ebayCategoryId, departmentSlug }
        : null,
      translations: product.translations as MapperProduct['translations'],
      images: product.images,
    }

    let groupPayload: InventoryItemGroupPayload
    const itemPayloads = new Map<string, ReturnType<typeof buildInventoryItemPayload>>()
    const offerBuilds = new Map<string, ReturnType<typeof buildOfferPayload>>()

    try {
      const mapperVariants: MapperVariant[] = variants.map((v) => ({
        id: v.id, sku: v.sku, barcode: v.barcode, color: v.color, size: v.size,
        priceModifier: v.priceModifier.toString(), weightGrams: v.weightGrams,
      }))
      groupPayload = buildInventoryItemGroupPayload(mapperProduct, mapperVariants, department)
      for (const v of variants) {
        const lr = listingByVariant.get(v.id)
        const mapperListing: MapperListing = {
          channelPrice: lr?.channelPrice ?? null,
          safetyStock: lr?.safetyStock ?? 1,
        }
        const mv: MapperVariant = {
          id: v.id, sku: v.sku, barcode: v.barcode, color: v.color, size: v.size,
          priceModifier: v.priceModifier.toString(), weightGrams: v.weightGrams,
        }
        const inv = inventoryByVariant.get(v.id) ?? []
        itemPayloads.set(v.sku, buildInventoryItemPayload(mapperListing, mapperProduct, mv, inv))
        offerBuilds.set(v.sku, buildOfferPayload({
          listing: mapperListing, product: mapperProduct, variant: mv, inventoryRows: inv,
          policyIds, merchantLocationKey,
        }))
      }
    } catch (e) {
      if (e instanceof MappingBlockError) {
        return await this.recordProductFail(productId, 'rejected', e.code, e.message, false, 'group')
      }
      throw e
    }

    // Step 5 — Token + Loop N: PUT inventory_item
    const token = await this.auth.getAccessTokenOrRefresh()
    const client = this.buildClient()

    for (const v of variants) {
      try {
        await client.request(
          'PUT',
          `/sell/inventory/v1/inventory_item/${encodeURIComponent(v.sku)}`,
          { bearer: token, bodyKind: 'json', body: itemPayloads.get(v.sku)! as unknown as Record<string, unknown> },
        )
      } catch (e) {
        return await this.handleGroupApiFailure(productId, e, 'inventory_item_failed')
      }
    }

    // Step 6 — Loop N: GET offer?sku → POST/PUT offer (DRAFT)
    for (const v of variants) {
      let existingOfferId: string | null = null
      try {
        const offers = await client.request<{ offers?: Array<{ offerId: string; marketplaceId: string; status: string }> }>(
          'GET',
          `/sell/inventory/v1/offer?sku=${encodeURIComponent(v.sku)}&marketplace_id=EBAY_DE&limit=5`,
          { bearer: token },
        )
        const match = (offers.offers ?? []).find((o) => o.marketplaceId === 'EBAY_DE')
        if (match) existingOfferId = match.offerId
      } catch (e) {
        if (!(e instanceof EbayApiError && e.status === 404)) {
          return await this.handleGroupApiFailure(productId, e, 'offer_lookup_failed')
        }
      }

      const offerBody = offerBuilds.get(v.sku)!.payload as unknown as Record<string, unknown>
      if (existingOfferId) {
        try {
          await client.request(
            'PUT',
            `/sell/inventory/v1/offer/${encodeURIComponent(existingOfferId)}`,
            { bearer: token, bodyKind: 'json', body: offerBody },
          )
        } catch (e) {
          return await this.handleGroupApiFailure(productId, e, 'offer_update_failed')
        }
      } else {
        try {
          await client.request<{ offerId: string }>(
            'POST',
            `/sell/inventory/v1/offer`,
            { bearer: token, bodyKind: 'json', body: offerBody },
          )
        } catch (e) {
          return await this.handleGroupApiFailure(productId, e, 'offer_create_failed')
        }
      }
    }

    // Step 7 — PUT inventory_item_group
    try {
      await client.request(
        'PUT',
        `/sell/inventory/v1/inventory_item_group/${encodeURIComponent(groupKey)}`,
        { bearer: token, bodyKind: 'json', body: groupPayload as unknown as Record<string, unknown> },
      )
    } catch (e) {
      return await this.handleGroupApiFailure(productId, e, 'group_create_failed')
    }

    // Step 8 — POST publish_by_inventory_item_group
    let externalListingId: string | null = null
    try {
      const resp = await client.request<{ listingId?: string; warnings?: any[] }>(
        'POST',
        `/sell/inventory/v1/offer/publish_by_inventory_item_group`,
        { bearer: token, bodyKind: 'json', body: { inventoryItemGroupKey: groupKey, marketplaceId: 'EBAY_DE' } },
      )
      externalListingId = resp.listingId ?? null
      if (resp.warnings && resp.warnings.length > 0) {
        this.logger.warn(`Group-publish warnings for ${productId}: ${JSON.stringify(resp.warnings).slice(0, 500)}`)
      }
    } catch (e) {
      return await this.handleGroupApiFailure(productId, e, 'publish_group_failed')
    }

    if (!externalListingId) {
      return await this.recordProductFail(
        productId, 'rejected', 'no_listing_id_after_group_publish',
        'eBay did not return listingId after publish_by_inventory_item_group', false, 'group',
      )
    }

    // Step 9 — Multi-Row Persistence (Q-D3)
    await this.prisma.channelProductListing.updateMany({
      where: { productId, channel: 'ebay', status: 'pending' },
      data: { status: 'active', externalListingId, syncError: null, lastSyncedAt: new Date() },
    })

    // Step 10 — Audit log
    await this.audit.log({
      adminId: 'system',
      action: 'EBAY_PRODUCT_GROUP_PUBLISHED',
      entityType: 'product',
      entityId: productId,
      changes: {
        after: { groupKey, externalListingId, variantCount: variants.length },
      },
    })

    return {
      ok: true, productId, mode: 'group',
      externalListingId, variantCount: variants.length, groupKey,
    }
  }

  // ────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────

  private async recordProductFail(
    productId: string,
    nextStatus: ChannelListingStatus,
    errorCode: string,
    errorMessage: string,
    retryable: boolean,
    mode: 'single' | 'group' | 'unknown',
  ): Promise<PublishProductResult> {
    // Q-D4 — Multi-Row updateMany with same syncError
    try {
      await this.prisma.channelProductListing.updateMany({
        where: { productId, channel: 'ebay', status: 'pending' },
        data: {
          status: nextStatus,
          syncError: `${errorCode}: ${errorMessage}`.slice(0, 500),
          lastSyncedAt: new Date(),
        },
      })
    } catch (dbErr: any) {
      this.logger.warn(`Failed to persist group-fail state for ${productId}: ${dbErr?.message}`)
    }
    await this.audit.log({
      adminId: 'system',
      action: 'EBAY_PRODUCT_GROUP_REJECTED',
      entityType: 'product',
      entityId: productId,
      changes: { after: { errorCode, errorMessage, retryable, nextStatus, mode } },
    })
    return { ok: false, productId, errorCode, errorMessage, retryable, mode }
  }

  private async handleGroupApiFailure(
    productId: string,
    err: unknown,
    errorCode: string,
  ): Promise<PublishProductResult> {
    if (err instanceof EbayApiError) {
      // Q-17 — explicit error-code mapping for group-specific errors
      const groupSpecificCodes = [25025, 25401, 25402]
      const groupErr = err.ebayErrors.find((e) => groupSpecificCodes.includes(e.errorId ?? 0))
      if (groupErr) {
        return await this.recordProductFail(
          productId, 'rejected',
          `group_${errorCode}_${groupErr.errorId}`,
          (groupErr.message ?? 'group variation error').slice(0, 500),
          false, 'group',
        )
      }
      // 25002 umbrella — reuse Bug-B-message-Branching (analog publishOne)
      const ebay25002 = err.ebayErrors.find((x) => x.errorId === 25002)
      if (ebay25002) {
        const haystack = `${ebay25002.message ?? ''} ${ebay25002.longMessage ?? ''}`.toLowerCase()
        const isAlreadyPublished =
          haystack.includes('already published') || haystack.includes('bereits veröffentlicht')
        if (!isAlreadyPublished) {
          const detail = `${ebay25002.message ?? ''}${ebay25002.longMessage ? ' / ' + ebay25002.longMessage : ''}`.slice(0, 500)
          return await this.recordProductFail(productId, 'rejected', 'publish_rejected', detail, false, 'group')
        }
        return await this.recordProductFail(
          productId, 'rejected', 'group_already_published_no_id',
          'eBay reports group already published — manual recovery required', false, 'group',
        )
      }
      const retryable = err.retryable
      const nextStatus: ChannelListingStatus = retryable ? 'pending' : 'rejected'
      return await this.recordProductFail(
        productId, nextStatus, errorCode, err.message.slice(0, 500), retryable, 'group',
      )
    }
    return await this.recordProductFail(
      productId, 'pending', `${errorCode}_unknown`,
      String((err as any)?.message ?? err).slice(0, 500), true, 'group',
    )
  }

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
