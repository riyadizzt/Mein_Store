/**
 * Marketplace Core — OrderImportFlow (C9).
 *
 * Template-method orchestrator. Runs the same sequence of steps
 * for every marketplace; the concrete adapter fills in the
 * hook-callback bodies.
 *
 * What this flow owns (central, shared, tested ONCE):
 *   1. Cheap extract of the dedup key via the adapter hook.
 *   2. Idempotency gate (MarketplaceImportStore.claim) — the one
 *      place duplicate-import is detected. DB-native in C10+,
 *      in-memory fake for C9 tests.
 *   3. Buyer resolution + order-draft mapping via adapter hooks.
 *   4. Structured audit of each outcome (IMPORTED / FAILED / SKIPPED).
 *   5. Error classification — MappingError / DuplicateImportError /
 *      InsufficientStockForMarketplaceOrderError / unknown.
 *
 * What the flow does NOT own (delegated to adapter or to later commits):
 *   - Actual marketplace HTTP calls (adapter).
 *   - Invocation of OrdersService.create (C12 — flow returns the
 *     draft + importId and lets the C12 commit-glue do the final
 *     handoff to the Orders module).
 *   - NestJS DI wiring. The flow is a plain class, injected with
 *     three ports at construction time.
 *
 * The contract between flow and caller:
 *   Flow returns a FlowOutcome describing exactly what happened.
 *   Caller (in C12: the marketplaces module) uses .status to decide
 *   next steps (e.g. hand draft to OrdersService only when
 *   status === 'imported').
 */

import type { Marketplace } from '@prisma/client'
import type {
  MarketplaceImportEvent,
  MarketplaceImportStore,
  MarketplaceAuditPort,
  MarketplaceNotificationPort,
  MarketplaceOrderDraft,
} from './types'
import type { IOrderImporter } from './adapter.interfaces'
import {
  MarketplaceError,
  DuplicateImportError,
  MappingError,
  InsufficientStockForMarketplaceOrderError,
} from './errors'

// ──────────────────────────────────────────────────────────────
// Public result types
// ──────────────────────────────────────────────────────────────

export type FlowOutcome =
  | {
      status: 'imported'
      importId: string
      externalOrderId: string
      marketplace: Marketplace
      /**
       * The mapped draft — caller hands this to OrdersService in
       * C12. In C9 no consumer uses it yet; the flow just produces
       * it and returns.
       */
      draft: MarketplaceOrderDraft
    }
  | {
      status: 'failed'
      importId?: string
      externalOrderId: string
      marketplace: Marketplace
      /** Short human-readable reason (≤500 chars). */
      error: string
      errorKind:
        | 'mapping'
        | 'insufficient_stock'
        | 'unknown'
    }
  | {
      status: 'skipped'
      importId: string
      externalOrderId: string
      marketplace: Marketplace
      existingOrderId?: string | null
      /** Existing import-row status that caused the skip. */
      existingStatus: 'IMPORTING' | 'IMPORTED' | 'FAILED' | 'SKIPPED'
    }

// ──────────────────────────────────────────────────────────────
// Audit action names — stable, marketplace-agnostic
// ──────────────────────────────────────────────────────────────
// Phase 2 decision (user confirmed): no ebay-specific action names
// in the shared layer. Adapter-level audit (e.g. EBAY_TOKEN_REFRESHED)
// is separately written by the adapter module, not here.

export const FLOW_AUDIT_ACTIONS = {
  IMPORTED: 'MARKETPLACE_ORDER_IMPORTED',
  FAILED: 'MARKETPLACE_ORDER_IMPORT_FAILED',
  SKIPPED: 'MARKETPLACE_ORDER_IMPORT_SKIPPED',
} as const

// ──────────────────────────────────────────────────────────────
// Flow
// ──────────────────────────────────────────────────────────────

export interface OrderImportFlowDeps {
  importer: IOrderImporter
  store: MarketplaceImportStore
  audit: MarketplaceAuditPort
  notify: MarketplaceNotificationPort
}

export class OrderImportFlow {
  constructor(private readonly deps: OrderImportFlowDeps) {}

  /**
   * Run one import attempt. Never throws — every outcome is
   * represented as a structured FlowOutcome. Unexpected exceptions
   * are captured, the import row marked FAILED with
   * errorKind='unknown', and the thrown message preserved.
   *
   * Callers that want the original exception (e.g. to surface it
   * to Sentry) can still observe it via the `error` field.
   */
  async run(event: MarketplaceImportEvent): Promise<FlowOutcome> {
    const { importer, store, audit, notify } = this.deps

    // Step 1 — cheap synchronous-or-fast id extraction.
    // If the adapter's extractExternalId itself throws, we do not
    // have enough context to persist a failed import row (no
    // externalOrderId yet). We surface this as an 'unknown'
    // failure keyed to event.externalOrderId from the envelope.
    let externalOrderId: string
    try {
      externalOrderId = await Promise.resolve(importer.extractExternalId(event))
    } catch (e: any) {
      const reason = truncate(`extract-external-id failed: ${e?.message ?? String(e)}`)
      return {
        status: 'failed',
        externalOrderId: event.externalOrderId,
        marketplace: event.marketplace,
        error: reason,
        errorKind: 'unknown',
      }
    }

    // Step 2 — idempotency gate. First writer wins, everyone else
    // gets the already_exists branch and exits cleanly.
    let claim
    try {
      claim = await store.claim(event.marketplace, externalOrderId, event.rawEventId)
    } catch (e: any) {
      // DuplicateImportError is legal here: some store implementations
      // prefer to raise instead of returning already_exists. Treat
      // that symmetrically.
      if (e instanceof DuplicateImportError) {
        const reason = `duplicate import (raised by store)`
        // We cannot distinguish the existing row's linked orderId
        // without extra work — adapters that want richer skip info
        // should return ClaimResult instead of throwing.
        await safeAudit(audit, {
          action: FLOW_AUDIT_ACTIONS.SKIPPED,
          entityType: 'marketplace_order_import',
          entityId: externalOrderId,
          changes: { marketplace: event.marketplace, reason, source: event.source },
        })
        return {
          status: 'skipped',
          importId: externalOrderId, // fallback — no real row id available
          externalOrderId,
          marketplace: event.marketplace,
          existingStatus: 'IMPORTING',
        }
      }
      return {
        status: 'failed',
        externalOrderId,
        marketplace: event.marketplace,
        error: truncate(`store.claim failed: ${e?.message ?? String(e)}`),
        errorKind: 'unknown',
      }
    }

    if (claim.outcome === 'already_exists') {
      await safeAudit(audit, {
        action: FLOW_AUDIT_ACTIONS.SKIPPED,
        entityType: 'marketplace_order_import',
        entityId: claim.importId,
        changes: {
          marketplace: event.marketplace,
          existingStatus: claim.existingStatus,
          existingOrderId: claim.existingOrderId ?? null,
          source: event.source,
        },
      })
      return {
        status: 'skipped',
        importId: claim.importId,
        externalOrderId,
        marketplace: event.marketplace,
        existingOrderId: claim.existingOrderId ?? null,
        existingStatus: claim.existingStatus,
      }
    }

    // From here on we own a freshly-claimed import row (IMPORTING).
    // Every exit path must call markImported / markFailed exactly
    // once before returning, so admins never see orphan IMPORTING rows.
    const importId = claim.importId

    // Step 3 — buyer resolution.
    let buyer
    try {
      buyer = await importer.resolveBuyer(event)
    } catch (e: any) {
      return await this.fail(
        event,
        externalOrderId,
        importId,
        e instanceof MappingError ? 'mapping' : 'unknown',
        truncate(`resolveBuyer failed: ${e?.message ?? String(e)}`),
      )
    }

    // Step 4 — order-draft mapping.
    let draft: MarketplaceOrderDraft
    try {
      draft = await importer.mapToOrderDraft(event, buyer)
    } catch (e: any) {
      if (e instanceof InsufficientStockForMarketplaceOrderError) {
        // Insufficient-stock is a visible incident — notify admins
        // in addition to the audit trail.
        await safeNotify(notify, {
          type: 'marketplace_oversell_alert',
          data: {
            marketplace: event.marketplace,
            externalOrderId,
            offendingLines: e.offendingLines,
          },
        })
        return await this.fail(
          event,
          externalOrderId,
          importId,
          'insufficient_stock',
          truncate(`insufficient stock: ${JSON.stringify(e.offendingLines).slice(0, 300)}`),
        )
      }
      if (e instanceof MappingError) {
        return await this.fail(
          event,
          externalOrderId,
          importId,
          'mapping',
          truncate(`mapToOrderDraft failed: ${e.message}`),
        )
      }
      return await this.fail(
        event,
        externalOrderId,
        importId,
        'unknown',
        truncate(`mapToOrderDraft threw: ${e?.message ?? String(e)}`),
      )
    }

    // Success path. We DO NOT call OrdersService here — that's C12's
    // concern. Our job is done: the draft is ready, the import row
    // is still IMPORTING. The C12 glue will drive it from here:
    //
    //   1. hand draft + buyer to OrdersService.create()
    //   2. on success: store.markImported(importId, localOrderId, metadata)
    //   3. on failure: store.markFailed(importId, reason, metadata)
    //
    // In C9 the test suite drives this finalisation itself; in C12
    // the marketplaces module owns the glue.
    //
    // Note: we intentionally DO NOT emit the IMPORTED audit here.
    // The commit-glue does that after OrdersService confirms — so
    // the audit trail never shows "imported" before a local Order
    // actually exists.

    return {
      status: 'imported',
      importId,
      externalOrderId,
      marketplace: event.marketplace,
      draft,
    }
  }

  // ────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────

  private async fail(
    event: MarketplaceImportEvent,
    externalOrderId: string,
    importId: string,
    errorKind: Exclude<
      Extract<FlowOutcome, { status: 'failed' }>['errorKind'],
      never
    >,
    error: string,
  ): Promise<FlowOutcome> {
    const { store, audit } = this.deps

    // Best-effort markFailed. If that itself throws, we still return
    // a failed outcome — callers must not see a successful return
    // while the DB thinks the import is IMPORTING.
    try {
      await store.markFailed(importId, error, {
        marketplace: event.marketplace,
        source: event.source,
        errorKind,
      })
    } catch (persistErr: any) {
      // Downgrade to console.warn at the flow layer; the adapter
      // module can elevate to Sentry.
      // eslint-disable-next-line no-console
      console.warn(
        `[marketplace flow] markFailed itself failed for importId=${importId}: ${persistErr?.message ?? persistErr}`,
      )
    }

    await safeAudit(audit, {
      action: FLOW_AUDIT_ACTIONS.FAILED,
      entityType: 'marketplace_order_import',
      entityId: importId,
      changes: {
        marketplace: event.marketplace,
        externalOrderId,
        errorKind,
        error,
        source: event.source,
      },
    })

    return {
      status: 'failed',
      importId,
      externalOrderId,
      marketplace: event.marketplace,
      error,
      errorKind,
    }
  }
}

// ──────────────────────────────────────────────────────────────
// Utility — best-effort audit / notification wrappers
// ──────────────────────────────────────────────────────────────
//
// A failure of the audit or notification port MUST NOT mutate the
// flow outcome. Audit/notification failure is a visibility bug,
// not a business-logic bug. These helpers swallow errors locally
// (and log them so tests & observability can still see).

async function safeAudit(
  audit: MarketplaceAuditPort,
  entry: Parameters<MarketplaceAuditPort['log']>[0],
): Promise<void> {
  try {
    await audit.log(entry)
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn(`[marketplace flow] audit.log failed: ${e?.message ?? e}`)
  }
}

async function safeNotify(
  notify: MarketplaceNotificationPort,
  entry: Parameters<MarketplaceNotificationPort['notifyAdmins']>[0],
): Promise<void> {
  try {
    await notify.notifyAdmins(entry)
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn(`[marketplace flow] notifyAdmins failed: ${e?.message ?? e}`)
  }
}

function truncate(s: string): string {
  // MarketplaceOrderImport.error is DB Text but we cap at 500 chars
  // at the service layer to keep audit payloads readable. Matches
  // the contract already documented in the types file.
  return s.length > 500 ? s.slice(0, 497) + '...' : s
}

// Re-export error classes for consumers that import from this
// module as the "public entrypoint" of the core.
export {
  MarketplaceError,
  DuplicateImportError,
  MappingError,
  InsufficientStockForMarketplaceOrderError,
}
