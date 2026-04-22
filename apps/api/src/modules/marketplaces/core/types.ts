/**
 * Marketplace Core — shared DTO types (C9).
 *
 * Marketplace-AGNOSTIC shapes consumed by the template-method
 * OrderImportFlow. Every adapter (eBay/TikTok/...) maps its native
 * payload to these shapes and returns them from the adapter-hook
 * callbacks. The flow orchestrator never touches marketplace-
 * specific field names.
 *
 * Naming hygiene (Arbeitsregel Phase 2):
 *   - ONLY externalOrderId / externalListingId / externalBuyerRef /
 *     externalSkuRef / rawEventPayload are allowed for marketplace-
 *     originated IDs.
 *   - The Marketplace enum (from @prisma/client) identifies which
 *     adapter we are talking to — no hard-coded string checks.
 *
 * Decimal handling: amounts are passed as strings in fixed EUR format
 * with two decimals ("49.99"), never as number, so we do not lose
 * precision at the JSON/JS-float boundary. OrdersService already
 * accepts strings for Decimal fields.
 */

import type { Marketplace } from '@prisma/client'

// ──────────────────────────────────────────────────────────────
// Event envelope
// ──────────────────────────────────────────────────────────────

/**
 * A single inbound event, webhook-delivered OR pulled by a cron.
 * The adapter produces this shape from the raw marketplace payload,
 * the flow operates exclusively on it.
 */
export interface MarketplaceImportEvent {
  marketplace: Marketplace
  externalOrderId: string
  /**
   * Opaque correlation id for replay/debug. Comes from the
   * marketplace's own event envelope (eBay notificationId, TikTok
   * webhook id, …). Persisted on MarketplaceOrderImport.rawEventId
   * if available; optional because pull-cron has no inbound
   * envelope of its own.
   */
  rawEventId?: string
  /**
   * The original payload as received from the marketplace. Used by
   * adapter-hook callbacks to derive order lines, buyer info, etc.
   * Flow-core treats it as opaque.
   */
  rawEventPayload: unknown
  /**
   * Where the event entered the system. Recorded for audit / debug;
   * does NOT change flow behaviour.
   */
  source: 'webhook' | 'pull'
}

// ──────────────────────────────────────────────────────────────
// Canonical intermediate shapes produced by adapter-hook callbacks
// ──────────────────────────────────────────────────────────────

/**
 * Single buyer-facing address line. Uses the same field names as
 * `InlineShippingAddressDto` in the Orders module so adapters can
 * pass it through unchanged once the DTO is built.
 */
export interface MarketplaceAddress {
  firstName: string
  lastName: string
  street: string
  houseNumber: string
  addressLine2?: string
  postalCode: string
  city: string
  country: string
  company?: string
}

/**
 * Who bought the item(s). Resolved from the raw payload in the
 * `resolveBuyer` adapter-hook. The flow uses this to decide whether
 * to create/reuse a stub user. Actual user-creation is delegated
 * to OrdersService (in C12 — not in C9).
 */
export interface MarketplaceBuyer {
  /**
   * Real buyer email if the marketplace exposes one. Many
   * marketplaces (eBay, TikTok) proxy/mask buyer emails — in that
   * case synthesize one like `{marketplace}-{externalBuyerRef}
   * @marketplace.local` and set `isSynthetic = true`.
   */
  email: string
  isSynthetic: boolean
  /**
   * Marketplace-internal buyer identifier (eBay username, TikTok
   * user-id hash, …). Persisted on MarketplaceOrderImport.metadata
   * for admin lookup and audit. Never joined to anything.
   */
  externalBuyerRef: string
  firstName?: string
  lastName?: string
  /**
   * Preferred locale for order-confirmation emails. Defaults to 'de'
   * if adapter cannot determine one. Pass-through to OrdersService
   * DTO .locale.
   */
  locale?: 'de' | 'en' | 'ar'
}

/**
 * One order line as resolved by the adapter. variantId is a LOCAL
 * uuid — the adapter is responsible for translating marketplace SKU
 * / item-id to our variant (this lookup can legitimately fail and
 * must raise MappingError).
 */
export interface MarketplaceOrderLine {
  /**
   * Our internal product_variants.id. Adapter must resolve this
   * from externalSkuRef / externalListingId BEFORE calling the
   * flow orchestrator. If adapter cannot resolve, it must throw
   * MappingError so the flow records the failure correctly.
   */
  variantId: string
  externalSkuRef: string
  /**
   * Optional — if the marketplace exposes the listing ID separately
   * from the SKU (eBay does), record it for audit.
   */
  externalListingId?: string
  quantity: number
  /**
   * Per-unit price as captured by the marketplace, as string.
   * Currency implicit via MarketplaceOrderSnapshot.currency. Used
   * by OrdersService to overwrite our shop price (marketplaces
   * charge different prices than the website — see Phase-2
   * Frage 3 analysis).
   */
  unitPriceGross: string
}

/**
 * Top-level shape the adapter returns from `mapToOrderDraft`.
 * Complete enough for the flow to hand off to OrdersService in
 * C12. In C9 we only define it — no service call is issued.
 */
export interface MarketplaceOrderDraft {
  lines: MarketplaceOrderLine[]
  shippingAddress: MarketplaceAddress
  /**
   * Gross totals as captured by the marketplace. The flow verifies
   * line-item sum equals this to within 1 cent — mismatch raises
   * MappingError (implemented in C12; in C9 just part of contract).
   */
  subtotalGross: string
  shippingCostGross: string
  totalGross: string
  currency: 'EUR'
  /**
   * Coupon / promo info if the marketplace carries one. Malak may
   * not use it on eBay, but TikTok often does — keep the slot open.
   */
  couponCode?: string
  /**
   * Free-form note intended for the local Order.notes field. Plain
   * string, per Phase-2 impact analysis (Order.notes is not JSON).
   */
  notes?: string
}

// ──────────────────────────────────────────────────────────────
// Idempotency gate — Port-Interface
// ──────────────────────────────────────────────────────────────

export type ClaimResult =
  | {
      /**
       * First importer wins — a new MarketplaceOrderImport row was
       * created with status=IMPORTING. Flow proceeds to build the
       * order draft.
       */
      outcome: 'claimed'
      importId: string
    }
  | {
      /**
       * Another importer already claimed this (marketplace,
       * externalOrderId). Flow exits as SKIPPED — caller records
       * audit, does NOT attempt to create a duplicate order.
       */
      outcome: 'already_exists'
      /** The existing row's id, for audit correlation. */
      importId: string
      /** Present if the existing row already linked a local order. */
      existingOrderId?: string | null
      existingStatus: 'IMPORTING' | 'IMPORTED' | 'FAILED' | 'SKIPPED'
    }

export interface MarketplaceImportStore {
  /**
   * Atomic insert-or-detect. First caller gets `outcome='claimed'`,
   * every subsequent caller for the same (marketplace, externalOrderId)
   * gets `outcome='already_exists'`. Implementation uses the DB
   * unique constraint @@unique([marketplace, externalOrderId]) —
   * the race is resolved by Postgres, not app code.
   */
  claim(
    marketplace: Marketplace,
    externalOrderId: string,
    rawEventId?: string,
  ): Promise<ClaimResult>

  /** Transition IMPORTING → IMPORTED, link local order. */
  markImported(importId: string, orderId: string, metadata?: Record<string, unknown>): Promise<void>

  /** Transition IMPORTING → FAILED with a short reason (≤500 chars). */
  markFailed(importId: string, error: string, metadata?: Record<string, unknown>): Promise<void>
}

// ──────────────────────────────────────────────────────────────
// Audit + Notification — Port-Interfaces
// ──────────────────────────────────────────────────────────────
//
// Deliberately narrow subsets of the full AuditService /
// NotificationService surfaces. Keeps the core free of NestJS DI
// concerns. The C10+ adapter module wires Prisma-backed
// implementations to satisfy these ports.

export interface MarketplaceAuditPort {
  /**
   * Record a flow-level event. Shape matches existing audit-log
   * conventions (see apps/api/src/modules/admin/services/audit.service.ts)
   * but we intentionally keep this narrow so implementations can
   * wrap either a full AuditService or an in-memory fake for tests.
   */
  log(event: {
    action: string
    entityType: 'marketplace_order_import' | 'order'
    entityId: string
    adminId?: string | null
    changes?: Record<string, unknown>
  }): Promise<void>
}

export interface MarketplaceNotificationPort {
  /**
   * Dispatch a bell-icon notification to all admins for incident-
   * severity events (oversell, preflight failure, duplicate webhook
   * storm). Not used for routine flow steps.
   */
  notifyAdmins(event: {
    type: string
    data: Record<string, unknown>
  }): Promise<void>
}
