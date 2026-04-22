/**
 * Marketplace Core — error types (C9).
 *
 * Typed errors the template-method flow recognises. Adapter-hook
 * callbacks that cannot fulfil their contract throw one of these;
 * the flow catches them by `instanceof` and produces a consistent
 * audit/import-row outcome.
 *
 * Unknown errors (everything that is NOT one of these classes)
 * bubble up as an unhandled exception inside the flow, which marks
 * the import as FAILED with error="unexpected: <message>" and
 * re-throws so upstream (webhook controller / pull cron) can
 * register it in Sentry. We deliberately do NOT swallow unknowns.
 */

/** Base class — everything below extends this, so callers can
 *  `catch (e) { if (e instanceof MarketplaceError) … }` */
export class MarketplaceError extends Error {
  constructor(message: string, public readonly context?: Record<string, unknown>) {
    super(message)
    this.name = this.constructor.name
    // V8 stack-trace hygiene
    if (typeof (Error as any).captureStackTrace === 'function') {
      ;(Error as any).captureStackTrace(this, this.constructor)
    }
  }
}

/**
 * Raised by the MarketplaceImportStore when a second claim arrives
 * for a (marketplace, externalOrderId) pair that has already been
 * claimed. The flow catches this and exits as SKIPPED without
 * attempting a second Order-create.
 *
 * Most implementations prefer to signal via `ClaimResult.already_exists`
 * instead of throwing — this class exists for implementations that
 * rely on raising (e.g. raw Prisma P2002 unwrapped to a typed error).
 */
export class DuplicateImportError extends MarketplaceError {
  constructor(
    public readonly externalOrderId: string,
    context?: Record<string, unknown>,
  ) {
    super(`Duplicate marketplace import for externalOrderId=${externalOrderId}`, context)
  }
}

/**
 * Raised by `mapToOrderDraft` / `resolveBuyer` when the marketplace
 * payload cannot be translated to our internal shape. Typical
 * causes:
 *   - marketplace SKU does not resolve to any ProductVariant
 *   - required address field missing
 *   - gross-totals mismatch (line sum ≠ payload total)
 *   - variant is soft-deleted
 *
 * Flow transitions the import to FAILED with the short reason
 * string; original payload stays on the import row for replay.
 */
export class MappingError extends MarketplaceError {
  constructor(
    reason: string,
    context?: Record<string, unknown>,
  ) {
    super(reason, context)
  }
}

/**
 * Raised by downstream stock-verification BEFORE the local Order
 * is created (C12 preflight). Kept in C9 for contract-completeness
 * so the flow can catch and record it; the flow itself does not
 * issue the check.
 *
 * The adapter or an upstream preflight service detects this and
 * throws; the flow marks the import as FAILED with a dedicated
 * error message that the admin UI can recognise and surface as
 * an oversell-incident banner.
 */
export class InsufficientStockForMarketplaceOrderError extends MarketplaceError {
  constructor(
    public readonly externalOrderId: string,
    public readonly offendingLines: Array<{
      externalSkuRef: string
      requested: number
      available: number
    }>,
  ) {
    super(
      `Insufficient stock to import marketplace order ${externalOrderId}`,
      { offendingLines },
    )
  }
}
