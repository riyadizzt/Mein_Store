/**
 * Backup retention helper (pure function).
 *
 * Given a list of existing SUCCESS backups, decides which should
 * remain, which should be PROMOTED from DAILY to MONTHLY, and which
 * should be expired (R2 object deleted, DB row marked EXPIRED).
 *
 * Rules (Basic-Level scope):
 *   DAILY        — keep the newest 30.
 *   MONTHLY      — keep the newest 12. A MONTHLY row is created by
 *                  PROMOTING the earliest DAILY of each calendar
 *                  month (by startedAt, UTC) before the daily sweep
 *                  runs, so the row survives being pruned from the
 *                  daily bucket.
 *   MANUAL       — keep 14 days from startedAt.
 *
 * Pure function: takes an in-memory snapshot, returns an action plan.
 * No DB/R2 side effects — the caller (BackupService) applies the plan.
 * This makes the retention math easy to unit-test without mocks.
 */

export const DAILY_RETENTION_COUNT = 30
export const MONTHLY_RETENTION_COUNT = 12
export const MANUAL_RETENTION_DAYS = 14

export type BackupTypeLite = 'DAILY' | 'MONTHLY' | 'MANUAL'

export interface BackupRowSnapshot {
  id: string
  type: BackupTypeLite
  startedAt: Date
  storageKey: string | null
}

export interface RetentionPlan {
  /** Rows to expire: R2 delete + status→EXPIRED. */
  toExpire: BackupRowSnapshot[]
  /** DAILY rows to promote to MONTHLY (R2 object stays, DB row re-tagged). */
  toPromote: BackupRowSnapshot[]
}

/**
 * Returns YYYY-MM bucket key (UTC) for a date. Grouping by UTC month
 * matches the 03:00 UTC cron schedule so the "first of month" backup
 * ends up in the same bucket as the month it represents.
 */
function ymKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Build the retention action plan.
 *
 * @param backups   All SUCCESS-status backups (any type). Order is not
 *                  assumed; the helper sorts internally.
 * @param now       Current time (injectable for tests).
 */
export function computeRetentionPlan(
  backups: BackupRowSnapshot[],
  now: Date = new Date(),
): RetentionPlan {
  const toExpire: BackupRowSnapshot[] = []
  const toPromote: BackupRowSnapshot[] = []

  // ── Bucket by type ────────────────────────────────────────
  const daily = backups.filter((b) => b.type === 'DAILY')
  const monthly = backups.filter((b) => b.type === 'MONTHLY')
  const manual = backups.filter((b) => b.type === 'MANUAL')

  // ── MONTHLY promotion ─────────────────────────────────────
  // For each calendar month that does NOT already have a MONTHLY row,
  // pick the EARLIEST DAILY in that month and flag it for promotion.
  // We intentionally promote the earliest, not the latest, so that the
  // "first of month" backup gets preserved — matches the user spec.
  const monthsWithMonthly = new Set(monthly.map((m) => ymKey(m.startedAt)))
  const dailyByMonth = new Map<string, BackupRowSnapshot[]>()
  for (const d of daily) {
    const key = ymKey(d.startedAt)
    if (!dailyByMonth.has(key)) dailyByMonth.set(key, [])
    dailyByMonth.get(key)!.push(d)
  }
  for (const [key, rows] of dailyByMonth.entries()) {
    if (monthsWithMonthly.has(key)) continue
    // Earliest in the month wins.
    const earliest = [...rows].sort(
      (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
    )[0]
    if (earliest) toPromote.push(earliest)
  }

  // A promoted row is no longer a "daily" for the keep-30 calculation.
  const promotedIds = new Set(toPromote.map((r) => r.id))
  const dailyAfterPromotion = daily.filter((d) => !promotedIds.has(d.id))

  // ── DAILY keep-30 ─────────────────────────────────────────
  // Newest 30 survive, rest expire.
  const dailySortedNewestFirst = [...dailyAfterPromotion].sort(
    (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
  )
  toExpire.push(...dailySortedNewestFirst.slice(DAILY_RETENTION_COUNT))

  // ── MONTHLY keep-12 ───────────────────────────────────────
  // Include the rows being promoted in this sweep so keep-12 is
  // computed against the full future state, not the stale one.
  const effectiveMonthly = [...monthly, ...toPromote]
  const monthlySortedNewestFirst = [...effectiveMonthly].sort(
    (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
  )
  toExpire.push(...monthlySortedNewestFirst.slice(MONTHLY_RETENTION_COUNT))

  // ── MANUAL age-out ────────────────────────────────────────
  const manualCutoff = now.getTime() - MANUAL_RETENTION_DAYS * 24 * 60 * 60 * 1000
  for (const m of manual) {
    if (m.startedAt.getTime() < manualCutoff) toExpire.push(m)
  }

  return { toExpire, toPromote }
}
