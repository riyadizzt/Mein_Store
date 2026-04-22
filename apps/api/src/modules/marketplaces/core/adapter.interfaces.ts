/**
 * Marketplace Core — adapter interfaces (C9).
 *
 * Three separate interfaces, intentionally. Adapters pick-and-choose
 * which they implement. An adapter that supports reading but not
 * writing (e.g. a read-only audit adapter) implements only
 * IOrderImporter. eBay in Phase 2 will implement all three;
 * TikTok in Phase 3 likewise.
 *
 * Marketplace-agnostic — no marketplace-specific fields or
 * hard-coded brand strings (no ebay-prefixed, no tiktok-prefixed
 * identifiers). Consumer sees these as abstract behaviour
 * contracts, not implementation hints.
 */

import type {
  MarketplaceImportEvent,
  MarketplaceOrderDraft,
  MarketplaceBuyer,
} from './types'

// ──────────────────────────────────────────────────────────────
// IListingPublisher — push our catalogue TO the marketplace
// ──────────────────────────────────────────────────────────────
//
// Used by C11 (eBay listing push) and the analogous Phase-3 commit
// for TikTok. C9 only defines the contract; no consumer exists yet.

export interface PublishListingInput {
  variantId: string
  /** Per-marketplace price (may differ from shop price).
   *  String to keep decimal precision. */
  priceGross: string
  /** Currently available quantity across all warehouses. Adapter
   *  decides how to report it (max-per-warehouse for eBay per
   *  Phase-2 analysis, TikTok TBD in Phase 3). */
  quantity: number
}

export interface PublishListingResult {
  externalListingId: string
  /** Free-form adapter-specific notes (eBay item-state, TikTok
   *  product-approval-state, …) the admin UI can surface. */
  adapterMetadata?: Record<string, unknown>
}

export interface IListingPublisher {
  publish(input: PublishListingInput): Promise<PublishListingResult>
  unpublish(externalListingId: string): Promise<void>
  updatePrice(externalListingId: string, priceGross: string): Promise<void>
  updateQuantity(externalListingId: string, quantity: number): Promise<void>
}

// ──────────────────────────────────────────────────────────────
// IOrderImporter — pull orders FROM the marketplace
// ──────────────────────────────────────────────────────────────
//
// The import flow (order-import-flow.ts) consumes THIS interface.
// Split into three hook-callbacks the flow invokes in sequence:
//
//   1. extractExternalId(event)  — cheap, synchronous parse to get
//      the dedup key. Runs BEFORE any side-effect.
//   2. resolveBuyer(event)       — async lookup / synthesis of
//      the MarketplaceBuyer. May query our own DB (user lookup).
//   3. mapToOrderDraft(event,    — full mapping to the draft the
//                      buyer)     flow will later hand to
//                                 OrdersService. Must throw
//                                 MappingError on any failure.
//
// Each callback is called at most once per import attempt. The
// flow wraps them in try/catch and records the outcome.

export interface IOrderImporter {
  /**
   * Parse the dedup key synchronously-or-quickly. Must NOT perform
   * expensive work — the flow calls this before the idempotency
   * gate, so a slow implementation would slow every inbound event.
   */
  extractExternalId(event: MarketplaceImportEvent): string | Promise<string>

  /**
   * Translate the raw payload into a canonical buyer shape.
   * May consult our own user table to reuse stub users from
   * earlier imports for the same buyer.
   */
  resolveBuyer(event: MarketplaceImportEvent): Promise<MarketplaceBuyer>

  /**
   * Produce the full draft for order-creation. Must throw a
   * MappingError for any structural problem in the payload
   * (missing SKU, unresolvable variant, totals mismatch, etc.).
   *
   * Notes for implementers:
   *   - variantId MUST be a valid local ProductVariant.id. If
   *     the adapter cannot resolve a marketplace SKU, throw
   *     MappingError — do NOT silently drop the line.
   *   - unitPriceGross comes from the marketplace, not our
   *     shop price. Preserve it verbatim.
   */
  mapToOrderDraft(
    event: MarketplaceImportEvent,
    buyer: MarketplaceBuyer,
  ): Promise<MarketplaceOrderDraft>
}

// ──────────────────────────────────────────────────────────────
// IReturnImporter — pull return/refund events FROM the marketplace
// ──────────────────────────────────────────────────────────────
//
// Distinct from IOrderImporter because returns have their own
// lifecycle in our system (R10-B in Phase-1-era). Split to keep
// each import flow small and independently testable.

export interface MarketplaceReturnEvent {
  marketplace: MarketplaceImportEvent['marketplace']
  /** Our local Order id the return refers to. Adapter must
   *  resolve this from the payload before calling the flow. */
  localOrderId: string
  /** Marketplace-native return id — recorded for audit. */
  externalReturnId: string
  rawEventPayload: unknown
}

export interface IReturnImporter {
  extractExternalReturnId(event: MarketplaceReturnEvent): string | Promise<string>
  /**
   * Map to the shape AdminReturnsService expects. Full mapping
   * type will be added in C16 when the return-integration commit
   * lands. Left `unknown` in C9 to avoid premature coupling.
   */
  mapToReturnRequest(event: MarketplaceReturnEvent): Promise<unknown>
}
