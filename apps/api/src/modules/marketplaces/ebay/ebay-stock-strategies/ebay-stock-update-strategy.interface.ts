/**
 * C15.6 — Stock-Update-Strategy Interface
 *
 * Shared contract für alle eBay-Stock-Update-Strategien.
 * Erlaubt Multi-Strategy-Pattern mit Auto-Fallback (siehe
 * ebay-stock-strategy-selector.ts).
 *
 * Strategy-Implementations (v3):
 *   - BulkUpdateStrategy (POST /bulk_update_price_quantity)  — broken seit 2026-04-29
 *   - GetThenPutStrategy (GET → modify → PUT inventory_item) — primary post-deploy
 *
 * Strategy C (OfferUpdate) wurde in v3 entfernt (Replace-Flaw-Risiko + YAGNI).
 * Bei beiden Strategies failed: ESCALATE-Pfad im Selector (siehe Section 3 PLAN.md v3).
 */

export type StrategyName = 'bulk' | 'get_then_put'

export interface StockUpdateContext {
  /** Listing-row aus DB (channel_product_listings). */
  listing: {
    id: string
    variantId: string | null
    externalListingId: string | null
  }
  /** SKU aus variant.sku (already resolved). */
  sku: string
  /** eBay-Sell-API offer-id (NICHT listingId — siehe C15.4 Format-Tarn-Effekt). */
  offerId: string
  /** Effektive Stock-Quantity die an eBay gepusht werden soll. */
  effectiveQuantity: number
  /** Bearer-Token für eBay-API-Calls (already decrypted, kurzlebig). */
  bearerToken: string
}

export interface StockUpdateResult {
  /** True bei eBay-side success + DB-side persisted (caller-Verantwortung). */
  ok: boolean
  /** HTTP-Status-Code des letzten eBay-Calls (0 wenn network-fail). */
  httpStatus: number
  /** Human-readable error-message (truncated auf 500 chars upstream). */
  errorMessage: string | null
  /** Parsed eBay errorId aus response.errors[0].errorId (falls vorhanden). */
  errorId: number | null
  /** True wenn eBay 429 → Selector should abort tick. */
  rateLimited: boolean
  /** True wenn Selector sollte SKU skippen (Lock konnte nicht acquired werden). */
  skipped?: boolean
  /** Pre/Post Snapshots aus Strategy B Snapshot-Verifier (forensic-only). */
  preSnapshot?: any
  postSnapshot?: any
  /** True wenn Snapshot-Verifier Daten-Verlust in PRESERVE_FIELDS erkannt hat. */
  dataLossDetected?: boolean
  /** Liste der Felder mit detected drift (z.B. ['product.title', 'groupIds']). */
  dataLossFields?: string[]
  /**
   * True only if eBay-side state confirmed post-mutation.
   *
   * Bulk strategy: HTTP 200 IS the confirmation (single-call API, no
   * separate verify step — eBay returns 200 only after applying changes).
   *
   * GetThenPut strategy: requires successful verify-GET that confirms the
   * new quantity matches what we PUT. Verify-timeout or verify-fail leaves
   * `ok=true` (PUT did go through) but `verifiedSuccess=false` because we
   * cannot prove the eBay-side state is in sync.
   *
   * Push-service contract: `lastSyncedQuantity` is persisted ONLY when
   * `verifiedSuccess=true`. If false, the next reconcile-cron tick will
   * see the listing as drifted and retry — natural self-healing without
   * claiming a sync we cannot prove. See Issue #6 (cancel-flow drift bug).
   */
  verifiedSuccess: boolean
}

export interface StockUpdateStrategy {
  /** Strategy-Identifier für Health-Tracking (Redis-Key + Audit-Action). */
  readonly name: StrategyName
  /**
   * Execute push für 1 SKU.
   *
   * Returns:
   *   ok=true bei eBay-success.
   *   ok=false + errorMessage gesetzt bei fail.
   *   rateLimited=true wenn eBay 429 (Selector abort tick).
   *
   * MUST NOT throw — alle Fehler müssen als StockUpdateResult zurückgegeben
   * werden. Selector kann auf Strategy-Fail durch next-strategy-Versuch
   * reagieren ohne try-catch wrapper.
   */
  execute(ctx: StockUpdateContext): Promise<StockUpdateResult>
}
