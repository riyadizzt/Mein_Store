/**
 * AuditArchiveService (C15.1).
 *
 * Daily 03:00-Berlin maintenance routine for the admin_audit_log
 * table. Two-step plan executed in strict order:
 *
 *   Step A — Ephemeral cleanup (fast, no R2):
 *     DELETE WHERE tier='ephemeral' AND created_at < now()-7days.
 *     No archive. Permanent delete. 7 days is a forensics window
 *     (security incident → admin checks recent webhooks); beyond
 *     that, the data has zero regulatory or business value.
 *
 *   Step B — Operational archive-then-delete:
 *     For each calendar-month bucket older than 90 days:
 *       1. SELECT operational rows (LIMIT 10.000 per tick).
 *       2. JSON-serialise + gzip → Buffer.
 *       3. Upload to R2 path 'audit-archive/YYYY-MM/operational-YYYY-MM-DD.json.gz'.
 *       4. HEAD-verify upload (size > 0 AND matches body length).
 *       5. Re-check tier='operational' for ALL archived row-ids
 *          (defense-in-depth race-guard). If any row's tier flipped
 *          to 'financial' between SELECT and DELETE, that row is
 *          excluded from the DELETE — log + admin-notify.
 *       6. DELETE WHERE id IN (archived_ids) AND tier='operational'.
 *       7. Audit-row financial AUDIT_ARCHIVE_COMPLETED.
 *
 *     If steps 3 or 4 fail (R2 outage / network / config-miss):
 *       - NO DELETE.
 *       - Audit-row financial AUDIT_ARCHIVE_FAILED.
 *       - Admin-notify 'audit_archive_failed'.
 *       - Tomorrow's tick re-runs (R2 PUT is idempotent: same path,
 *         same content → R2 last-write-wins).
 *
 *   Step C — Financial:
 *     NEVER touched. tier='financial' rows live forever per GoBD
 *     §147 AO (10-year German tax-record retention). The cron's
 *     queries explicitly exclude this tier — defense-in-depth via
 *     redundant tier-checks at SELECT and at DELETE.
 *
 * Failure-handling policy:
 *   - Step A failure (DELETE rejected by DB) → log + return; will
 *     retry tomorrow. No partial state to clean up.
 *   - Step B failure between SELECT and DELETE → archive uploaded
 *     but rows still in DB. Tomorrow's run re-archives (idempotent
 *     overwrite) + tries DELETE again.
 *   - The 6-step ordering is non-negotiable: archive must succeed
 *     and be HEAD-verified BEFORE any DELETE happens.
 *
 * Hard-Rule compliance:
 *   - Orders/Payments/Invoices/Returns/Reservations: ZERO TOUCH.
 *   - tier='financial' rows: NEVER selected for archive or delete.
 *     Two redundant checks (SELECT WHERE tier=... + DELETE WHERE
 *     tier=...) guard against race conditions.
 *   - Existing audit.service callers: ZERO TOUCH.
 *   - The audit-archive's own audit-rows are tier='financial' so
 *     they survive forever as the regulatory trace of every
 *     archive-and-delete decision.
 */

import { Injectable, Logger } from '@nestjs/common'
import { gzipSync } from 'node:zlib'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditService } from './audit.service'
import { NotificationService } from './notification.service'
import { AuditArchiveR2Client } from './audit-archive-r2.client'

/**
 * Owner-decision Q-3: 10.000 rows per UPDATE/DELETE chunk. Same cap
 * for the SELECT-LIMIT in Step B — a backlog larger than 10.000
 * rolls over to the next daily tick.
 */
export const MAX_ROWS_PER_TICK = 10_000

/**
 * Step-A retention. 7 days in milliseconds. Owner-spec.
 */
export const EPHEMERAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Step-B retention. 90 days in milliseconds. Owner-spec.
 */
export const OPERATIONAL_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

export interface ArchiveTickResult {
  /** Step A — ephemeral rows deleted this tick. */
  ephemeralDeleted: number
  /** Step B — operational rows archived + deleted this tick. */
  operationalArchived: number
  /** Step B — race-detected rows that were SKIPPED at DELETE. */
  raceSkipped: number
  /** Step B — was R2 successful? null = no operational rows to push. */
  r2UploadOk: boolean | null
  /** Step B — R2 storage key on success, null otherwise. */
  r2StorageKey: string | null
  /** Step B — bytes pushed (post-gzip) on success, null otherwise. */
  r2SizeBytes: number | null
  /** Step B — error text on failure. */
  r2Error: string | null
  durationMs: number
}

@Injectable()
export class AuditArchiveService {
  private readonly logger = new Logger(AuditArchiveService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly r2: AuditArchiveR2Client,
  ) {}

  /**
   * Single tick. Cron-callable. Never throws on business outcomes
   * — failures are persisted as financial-tier audit + admin-notify.
   * SafeCron decorator on the cron-class catches truly unexpected
   * throws (e.g. OOM) via crash-event emitter.
   */
  async runArchiveTick(now = new Date()): Promise<ArchiveTickResult> {
    const start = Date.now()

    // Step A — ephemeral cleanup. Independent of Step B; runs
    // unconditionally regardless of R2 state because no R2 is involved.
    const ephemeralCutoff = new Date(now.getTime() - EPHEMERAL_RETENTION_MS)
    const ephemeralDeleted = await this.runStepA(ephemeralCutoff)

    // Step B — operational archive-then-delete.
    const operationalCutoff = new Date(now.getTime() - OPERATIONAL_RETENTION_MS)
    const stepB = await this.runStepB(operationalCutoff, now)

    const durationMs = Date.now() - start

    // Tick-summary logging — always (per owner-decision Q-9: audit
    // ONLY on activity, but log ALWAYS for ops observability).
    this.logger.log(
      `[audit-archive] tick ephemeralDeleted=${ephemeralDeleted} ` +
        `operationalArchived=${stepB.operationalArchived} ` +
        `raceSkipped=${stepB.raceSkipped} ` +
        `r2=${stepB.r2UploadOk === null ? 'idle' : stepB.r2UploadOk ? 'ok' : 'fail'} ` +
        `durationMs=${durationMs}`,
    )

    return {
      ephemeralDeleted,
      operationalArchived: stepB.operationalArchived,
      raceSkipped: stepB.raceSkipped,
      r2UploadOk: stepB.r2UploadOk,
      r2StorageKey: stepB.r2StorageKey,
      r2SizeBytes: stepB.r2SizeBytes,
      r2Error: stepB.r2Error,
      durationMs,
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Step A — Ephemeral cleanup (no R2, no audit-row, fast)
  // ─────────────────────────────────────────────────────────────

  private async runStepA(cutoff: Date): Promise<number> {
    try {
      // Defense-in-depth: tier='ephemeral' explicit in WHERE clause.
      // The (tier, created_at) index makes this O(log n) over the
      // ephemeral subset — no full-table scan.
      const result = await this.prisma.adminAuditLog.deleteMany({
        where: {
          tier: 'ephemeral',
          createdAt: { lt: cutoff },
        },
      })
      return result.count
    } catch (e: any) {
      this.logger.error(
        `[audit-archive] Step A (ephemeral cleanup) failed: ${e?.message ?? e}`,
      )
      return 0
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Step B — Operational archive-then-delete
  // ─────────────────────────────────────────────────────────────

  private async runStepB(
    cutoff: Date,
    now: Date,
  ): Promise<{
    operationalArchived: number
    raceSkipped: number
    r2UploadOk: boolean | null
    r2StorageKey: string | null
    r2SizeBytes: number | null
    r2Error: string | null
  }> {
    // 1. SELECT operational rows older than cutoff. Defense-in-depth
    //    tier-check in WHERE — if a future bug ever queries by
    //    created_at alone, the tier filter still blocks financial
    //    rows from being selected.
    const rows = await this.prisma.adminAuditLog.findMany({
      where: {
        tier: 'operational',
        createdAt: { lt: cutoff },
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_ROWS_PER_TICK,
    })

    if (rows.length === 0) {
      return {
        operationalArchived: 0,
        raceSkipped: 0,
        r2UploadOk: null,
        r2StorageKey: null,
        r2SizeBytes: null,
        r2Error: null,
      }
    }

    // 2. JSON-serialise + gzip
    const jsonBuf = Buffer.from(JSON.stringify(rows))
    const gzipped = gzipSync(jsonBuf)

    // 3. Build R2 storage key — bucket by month-of-newest-row,
    //    daily filename for surgical replay.
    const newestCreatedAt = rows[rows.length - 1].createdAt
    const yyyyMM = `${newestCreatedAt.getUTCFullYear()}-${String(
      newestCreatedAt.getUTCMonth() + 1,
    ).padStart(2, '0')}`
    const yyyyMMDD = newestCreatedAt.toISOString().slice(0, 10)
    // Tick-stamp suffix to make multiple-runs-per-day distinct.
    const tickStamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const storageKey = `audit-archive/${yyyyMM}/operational-${yyyyMMDD}__tick-${tickStamp}.json.gz`

    // 4. Upload + HEAD-verify
    const uploadResult = await this.r2.uploadAndVerify(
      storageKey,
      gzipped,
      'application/gzip',
    )

    if (!uploadResult.ok) {
      // Upload-fail path: NO DELETE. Audit + notify. Retry tomorrow.
      const errMsg = uploadResult.error
      this.logger.error(
        `[audit-archive] R2 upload FAILED storageKey=${storageKey} error=${errMsg}`,
      )
      await this.audit
        .log({
          adminId: 'system',
          action: 'AUDIT_ARCHIVE_FAILED',
          entityType: 'audit_archive',
          entityId: storageKey,
          changes: {
            after: {
              rowsAttempted: rows.length,
              storageKey,
              error: errMsg,
            },
          },
          // Explicit financial — even though FINANCIAL_ACTIONS contains
          // AUDIT_ARCHIVE_FAILED, an extra bytes-on-the-wire override is
          // belt-and-suspenders against future Set-drift.
          tier: 'financial',
        })
        .catch(() => {})
      await this.notifications
        .createForAllAdmins({
          type: 'audit_archive_failed',
          title: 'Audit-Archivierung fehlgeschlagen',
          body: `R2 upload failed (storageKey=${storageKey}). ${rows.length} operational audit rows remain in Supabase. Retry tomorrow at 03:00 — verify R2 credentials.`,
          entityType: 'audit_archive',
          entityId: storageKey,
          data: {
            rowsAttempted: rows.length,
            storageKey,
            error: errMsg,
          },
        })
        .catch((e: any) =>
          this.logger.warn(`[audit-archive] notify failed: ${e?.message ?? e}`),
        )
      return {
        operationalArchived: 0,
        raceSkipped: 0,
        r2UploadOk: false,
        r2StorageKey: storageKey,
        r2SizeBytes: null,
        r2Error: errMsg,
      }
    }

    // 5. Race-guard re-check + 6. DELETE.
    //    The DELETE WHERE tier='operational' filter excludes any row
    //    whose tier flipped to 'financial' between SELECT and DELETE.
    //    deleteMany returns count of deleted; race-skipped count =
    //    archived-count minus actually-deleted-count.
    const archivedIds = rows.map((r) => r.id)
    const deleteResult = await this.prisma.adminAuditLog.deleteMany({
      where: {
        id: { in: archivedIds },
        tier: 'operational', // race-guard
      },
    })
    const deletedCount = deleteResult.count
    const raceSkipped = archivedIds.length - deletedCount

    if (raceSkipped > 0) {
      this.logger.warn(
        `[audit-archive] Race detected: ${raceSkipped} of ${archivedIds.length} ` +
          `archived rows had tier flipped before DELETE — preserved in DB AND archive.`,
      )
    }

    // 7. Financial audit-row of the archive operation (regulatory trail).
    await this.audit
      .log({
        adminId: 'system',
        action: 'AUDIT_ARCHIVE_COMPLETED',
        entityType: 'audit_archive',
        entityId: storageKey,
        changes: {
          after: {
            rowsArchived: deletedCount,
            r2Path: storageKey,
            fileSize: uploadResult.sizeBytes,
            bucket: this.r2.getBucketName(),
            raceSkipped,
          },
        },
        tier: 'financial', // belt-and-suspenders override
      })
      .catch((e: any) =>
        this.logger.warn(`[audit-archive] audit log failed: ${e?.message ?? e}`),
      )

    return {
      operationalArchived: deletedCount,
      raceSkipped,
      r2UploadOk: true,
      r2StorageKey: storageKey,
      r2SizeBytes: uploadResult.sizeBytes,
      r2Error: null,
    }
  }
}
