/**
 * Backup retention helper unit tests.
 *
 * Pure-function tests — no DB, no R2. Each test seeds an in-memory
 * snapshot of backup rows and asserts the action plan.
 */

import {
  computeRetentionPlan,
  DAILY_RETENTION_COUNT,
  MONTHLY_RETENTION_COUNT,
  MANUAL_RETENTION_DAYS,
  type BackupRowSnapshot,
} from '../backup-retention'

function row(
  id: string,
  type: 'DAILY' | 'MONTHLY' | 'MANUAL',
  dateIso: string,
): BackupRowSnapshot {
  return { id, type, startedAt: new Date(dateIso), storageKey: `${type.toLowerCase()}/${id}` }
}

describe('computeRetentionPlan — DAILY keep-30', () => {
  it('keeps all daily backups when there are fewer than 30', () => {
    const backups: BackupRowSnapshot[] = []
    for (let i = 0; i < 10; i++) {
      backups.push(row(`d${i}`, 'DAILY', `2026-04-${String(i + 1).padStart(2, '0')}T03:00:00Z`))
    }
    const plan = computeRetentionPlan(backups, new Date('2026-04-20T12:00:00Z'))
    // The earliest of the month gets promoted to MONTHLY — not expired.
    expect(plan.toExpire).toEqual([])
    expect(plan.toPromote).toHaveLength(1)
  })

  it('expires dailies older than the 30th newest (after promotion)', () => {
    const backups: BackupRowSnapshot[] = []
    // 40 daily backups, one per day, all in Feb-Mar 2026 so there's a
    // single month with plenty of rows.
    for (let i = 0; i < 40; i++) {
      const day = new Date('2026-02-01T03:00:00Z')
      day.setUTCDate(day.getUTCDate() + i)
      backups.push(row(`d${i}`, 'DAILY', day.toISOString()))
    }
    const plan = computeRetentionPlan(backups, new Date('2026-03-15T12:00:00Z'))
    // Two promotions: one for Feb (earliest d0), one for Mar (earliest d28).
    expect(plan.toPromote.map((r) => r.id).sort()).toEqual(['d0', 'd28'])
    // After removing promoted rows from daily pool: 38 rows. Keep 30, expire 8.
    expect(plan.toExpire).toHaveLength(40 - 2 - DAILY_RETENTION_COUNT)
    // Expired rows must be the OLDEST ones post-promotion.
    const expiredIds = plan.toExpire.map((r) => r.id).sort()
    // d0 + d28 are promoted. Of the remaining, d1-d7 are the oldest — expired.
    expect(expiredIds).toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8'])
  })
})

describe('computeRetentionPlan — MONTHLY promotion', () => {
  it('promotes the earliest daily of each month that lacks a monthly', () => {
    const backups: BackupRowSnapshot[] = [
      row('feb-first', 'DAILY', '2026-02-01T03:00:00Z'),
      row('feb-mid', 'DAILY', '2026-02-15T03:00:00Z'),
      row('feb-last', 'DAILY', '2026-02-28T03:00:00Z'),
      row('mar-first', 'DAILY', '2026-03-01T03:00:00Z'),
    ]
    const plan = computeRetentionPlan(backups, new Date('2026-03-15T12:00:00Z'))
    // feb-first and mar-first should be promoted (earliest per month).
    expect(plan.toPromote.map((r) => r.id).sort()).toEqual(['feb-first', 'mar-first'])
  })

  it('does NOT re-promote a month that already has a MONTHLY row', () => {
    const backups: BackupRowSnapshot[] = [
      row('feb-monthly', 'MONTHLY', '2026-02-01T03:00:00Z'),
      row('feb-first-daily', 'DAILY', '2026-02-01T03:00:00Z'),
      row('feb-mid-daily', 'DAILY', '2026-02-15T03:00:00Z'),
    ]
    const plan = computeRetentionPlan(backups, new Date('2026-02-20T12:00:00Z'))
    expect(plan.toPromote).toEqual([])
  })

  it('expires monthly backups beyond the newest 12', () => {
    const backups: BackupRowSnapshot[] = []
    for (let i = 0; i < 15; i++) {
      const d = new Date('2024-01-01T03:00:00Z')
      d.setUTCMonth(d.getUTCMonth() + i)
      backups.push(row(`m${i}`, 'MONTHLY', d.toISOString()))
    }
    const plan = computeRetentionPlan(backups, new Date('2026-04-15T12:00:00Z'))
    // 15 - 12 = 3 oldest monthlys expire.
    expect(plan.toExpire).toHaveLength(15 - MONTHLY_RETENTION_COUNT)
    expect(plan.toExpire.map((r) => r.id).sort()).toEqual(['m0', 'm1', 'm2'])
  })

  it('counts to-be-promoted rows against the 12 monthly limit', () => {
    // 12 existing monthlys + 1 promotion should trigger 1 expiry.
    const backups: BackupRowSnapshot[] = []
    for (let i = 0; i < 12; i++) {
      const d = new Date('2024-01-01T03:00:00Z')
      d.setUTCMonth(d.getUTCMonth() + i)
      backups.push(row(`m${i}`, 'MONTHLY', d.toISOString()))
    }
    // A DAILY in a NEW month that has no monthly yet — will be promoted.
    backups.push(row('new-daily', 'DAILY', '2026-04-01T03:00:00Z'))
    const plan = computeRetentionPlan(backups, new Date('2026-04-15T12:00:00Z'))
    expect(plan.toPromote.map((r) => r.id)).toEqual(['new-daily'])
    // After promotion the effective monthly count is 13 → oldest expires.
    expect(plan.toExpire.map((r) => r.id)).toEqual(['m0'])
  })
})

describe('computeRetentionPlan — MANUAL 14-day age-out', () => {
  it('expires manual backups older than 14 days', () => {
    const now = new Date('2026-04-30T12:00:00Z')
    const backups: BackupRowSnapshot[] = [
      row('old', 'MANUAL', '2026-04-10T12:00:00Z'), // 20 days old
      row('edge', 'MANUAL', '2026-04-16T12:00:00Z'), // 14 days old (still keep)
      row('fresh', 'MANUAL', '2026-04-25T12:00:00Z'), // 5 days old
    ]
    const plan = computeRetentionPlan(backups, now)
    expect(plan.toExpire.map((r) => r.id)).toEqual(['old'])
  })

  it(`uses exactly ${MANUAL_RETENTION_DAYS} days as the cutoff`, () => {
    const now = new Date('2026-04-30T12:00:00Z')
    const cutoff = new Date(now.getTime() - MANUAL_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    // One millisecond before the cutoff → expired.
    const justBefore = new Date(cutoff.getTime() - 1).toISOString()
    // One millisecond after the cutoff → kept.
    const justAfter = new Date(cutoff.getTime() + 1).toISOString()
    const backups: BackupRowSnapshot[] = [
      row('before', 'MANUAL', justBefore),
      row('after', 'MANUAL', justAfter),
    ]
    const plan = computeRetentionPlan(backups, now)
    expect(plan.toExpire.map((r) => r.id)).toEqual(['before'])
  })
})

describe('computeRetentionPlan — integration', () => {
  it('does not double-count: a promoted row is not in toExpire too', () => {
    // Simulate 45 dailies across 2 months.
    const backups: BackupRowSnapshot[] = []
    for (let i = 0; i < 45; i++) {
      const d = new Date('2026-02-01T03:00:00Z')
      d.setUTCDate(d.getUTCDate() + i)
      backups.push(row(`d${i}`, 'DAILY', d.toISOString()))
    }
    const plan = computeRetentionPlan(backups, new Date('2026-04-01T12:00:00Z'))
    const promotedIds = new Set(plan.toPromote.map((r) => r.id))
    const expiredIds = new Set(plan.toExpire.map((r) => r.id))
    for (const id of promotedIds) {
      expect(expiredIds.has(id)).toBe(false)
    }
  })

  it('handles empty input', () => {
    const plan = computeRetentionPlan([], new Date('2026-04-22T12:00:00Z'))
    expect(plan.toExpire).toEqual([])
    expect(plan.toPromote).toEqual([])
  })
})
