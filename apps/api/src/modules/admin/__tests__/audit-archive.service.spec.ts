/**
 * AuditArchiveService (C15.1) unit tests.
 *
 * Pins down (Hard-Rule-1: NEVER touch financial-tier rows):
 *   1. Step A: ephemeral cleanup uses tier='ephemeral' WHERE-clause.
 *   2. Step A: 7-day cutoff is correct.
 *   3. Step B happy path: SELECT operational → gzip → upload → verify
 *      → DELETE → financial AUDIT_ARCHIVE_COMPLETED row written.
 *   4. Step B 90-day cutoff is correct.
 *   5. Step B uses tier='operational' WHERE in SELECT.
 *   6. Step B uses tier='operational' WHERE in DELETE (race-guard).
 *   7. R2 upload-fail → NO DELETE + AUDIT_ARCHIVE_FAILED audit + admin-notify.
 *   8. R2 HEAD-verify size-mismatch → NO DELETE + AUDIT_ARCHIVE_FAILED.
 *   9. Race detected: DELETE returns count<archived → log warn + audit
 *      records raceSkipped count.
 *  10. Empty bucket (no operational rows) → no R2 call, no audit, no notify.
 *  11. financial-tier rows are NEVER selected (tier-filter in where).
 *  12. 10k cap respected.
 *  13. Re-run idempotent (uploaded, not deleted, run again → R2 PUT
 *      same key, same content; DELETE eventually drains).
 */

import 'reflect-metadata'
import {
  AuditArchiveService,
  MAX_ROWS_PER_TICK,
  EPHEMERAL_RETENTION_MS,
  OPERATIONAL_RETENTION_MS,
} from '../services/audit-archive.service'

function makeRow(overrides: any = {}) {
  return {
    id: overrides.id ?? `row-${Math.random().toString(36).slice(2, 8)}`,
    adminId: 'system',
    action: 'PRODUCT_UPDATED',
    entityType: 'product',
    entityId: 'prod-1',
    changes: { after: { x: 1 } },
    ipAddress: null,
    tier: 'operational',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

function makeService(opts: {
  ephemeralDeleteCount?: number
  operationalRows?: any[]
  operationalDeleteCount?: number  // simulates race (< rows.length)
  r2Result?: { ok: true; sizeBytes: number; storageKey: string } | { ok: false; error: string; storageKey: string }
  r2Configured?: boolean
} = {}) {
  const lastDeleteWhereClauses: any[] = []
  const lastFindWhereClauses: any[] = []
  const auditedActions: string[] = []
  const notified: any[] = []

  const prisma = {
    adminAuditLog: {
      deleteMany: jest.fn(({ where }: any) => {
        lastDeleteWhereClauses.push(where)
        // Step A clause: { tier:'ephemeral', createdAt:{lt:...} }
        if (where.tier === 'ephemeral') {
          return Promise.resolve({ count: opts.ephemeralDeleteCount ?? 0 })
        }
        // Step B clause: { id:{in:[...]}, tier:'operational' }
        if (where.tier === 'operational' && where.id?.in) {
          return Promise.resolve({
            count: opts.operationalDeleteCount ?? where.id.in.length,
          })
        }
        return Promise.resolve({ count: 0 })
      }),
      findMany: jest.fn(({ where }: any) => {
        lastFindWhereClauses.push(where)
        return Promise.resolve(opts.operationalRows ?? [])
      }),
    },
  }

  const audit = {
    log: jest.fn(({ action }: any) => {
      auditedActions.push(action)
      return Promise.resolve(undefined)
    }),
  }

  const notifications = {
    createForAllAdmins: jest.fn((data: any) => {
      notified.push(data)
      return Promise.resolve(undefined)
    }),
  }

  const r2 = {
    isConfigured: jest.fn(() => opts.r2Configured ?? true),
    getBucketName: jest.fn(() => 'malak-audit-archive'),
    uploadAndVerify: jest.fn(() =>
      Promise.resolve(
        opts.r2Result ?? {
          ok: true,
          sizeBytes: 1234,
          storageKey: 'audit-archive/2026-01/operational-2026-01-31__tick-2026-01-31T00-00-00.json.gz',
        },
      ),
    ),
  }

  const service = new AuditArchiveService(
    prisma as any,
    audit as any,
    notifications as any,
    r2 as any,
  )

  return {
    service,
    prisma,
    audit,
    notifications,
    r2,
    lastDeleteWhereClauses,
    lastFindWhereClauses,
    auditedActions,
    notified,
  }
}

// ──────────────────────────────────────────────────────────────
// Step A — Ephemeral cleanup
// ──────────────────────────────────────────────────────────────

describe('AuditArchiveService.runArchiveTick — Step A (ephemeral)', () => {
  it('ephemeral DELETE uses tier=ephemeral WHERE-clause', async () => {
    const { service, lastDeleteWhereClauses } = makeService({
      ephemeralDeleteCount: 11_200,
    })
    await service.runArchiveTick(new Date('2026-05-01T03:00:00Z'))

    const stepAWhere = lastDeleteWhereClauses.find((w) => w.tier === 'ephemeral')
    expect(stepAWhere).toBeDefined()
    expect(stepAWhere.tier).toBe('ephemeral')
    expect(stepAWhere.createdAt.lt).toBeInstanceOf(Date)
  })

  it('ephemeral cutoff = now - 7 days', async () => {
    const { service, lastDeleteWhereClauses } = makeService({
      ephemeralDeleteCount: 0,
    })
    const now = new Date('2026-05-01T03:00:00Z')
    await service.runArchiveTick(now)
    const cutoff = lastDeleteWhereClauses.find((w) => w.tier === 'ephemeral')!
      .createdAt.lt as Date
    const expected = new Date(now.getTime() - EPHEMERAL_RETENTION_MS)
    expect(cutoff.toISOString()).toBe(expected.toISOString())
  })

  it('returns ephemeralDeleted count from prisma', async () => {
    const { service } = makeService({ ephemeralDeleteCount: 11_200 })
    const result = await service.runArchiveTick()
    expect(result.ephemeralDeleted).toBe(11_200)
  })

  it('does NOT write audit-row for ephemeral (no audit-spam)', async () => {
    const { service, audit } = makeService({
      ephemeralDeleteCount: 5_000,
      operationalRows: [],
    })
    await service.runArchiveTick()
    // Only Step B writes audit-rows on activity. Step A is silent.
    expect((audit.log as jest.Mock)).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────
// Step B — Operational archive-then-delete
// ──────────────────────────────────────────────────────────────

describe('AuditArchiveService.runArchiveTick — Step B happy path', () => {
  it('SELECT uses tier=operational WHERE-clause + 90-day cutoff', async () => {
    const rows = [makeRow()]
    const { service, lastFindWhereClauses } = makeService({
      operationalRows: rows,
    })
    const now = new Date('2026-05-01T03:00:00Z')
    await service.runArchiveTick(now)

    const stepBWhere = lastFindWhereClauses[0]
    expect(stepBWhere.tier).toBe('operational')
    const expected = new Date(now.getTime() - OPERATIONAL_RETENTION_MS)
    expect((stepBWhere.createdAt.lt as Date).toISOString()).toBe(
      expected.toISOString(),
    )
  })

  it('SELECT respects 10k cap', async () => {
    const { service, prisma } = makeService({ operationalRows: [] })
    await service.runArchiveTick()
    const findCall = (prisma.adminAuditLog.findMany as jest.Mock).mock.calls[0][0]
    expect(findCall.take).toBe(MAX_ROWS_PER_TICK)
    expect(MAX_ROWS_PER_TICK).toBe(10_000)
  })

  it('happy path: SELECT → upload → DELETE → audit financial', async () => {
    const rows = [makeRow({ id: 'r1' }), makeRow({ id: 'r2' })]
    const { service, r2, lastDeleteWhereClauses, audit, auditedActions } =
      makeService({ operationalRows: rows })

    const result = await service.runArchiveTick()

    expect(r2.uploadAndVerify).toHaveBeenCalledTimes(1)
    expect(result.r2UploadOk).toBe(true)
    expect(result.operationalArchived).toBe(2)

    // DELETE used tier='operational' guard
    const deleteWhere = lastDeleteWhereClauses.find((w) => w.id?.in)
    expect(deleteWhere.tier).toBe('operational')
    expect(deleteWhere.id.in).toEqual(['r1', 'r2'])

    // audit-row AUDIT_ARCHIVE_COMPLETED written
    expect(auditedActions).toContain('AUDIT_ARCHIVE_COMPLETED')
    const archiveCall = (audit.log as jest.Mock).mock.calls.find(
      (c) => c[0].action === 'AUDIT_ARCHIVE_COMPLETED',
    )
    expect(archiveCall[0].tier).toBe('financial') // explicit override
    expect(archiveCall[0].changes.after.rowsArchived).toBe(2)
  })

  it('DELETE WHERE-clause includes tier=operational (race-guard, defense-in-depth)', async () => {
    const rows = [makeRow({ id: 'r1' })]
    const { service, lastDeleteWhereClauses } = makeService({
      operationalRows: rows,
    })
    await service.runArchiveTick()
    const deleteWhere = lastDeleteWhereClauses.find((w) => w.id?.in)
    // BOTH conditions required
    expect(deleteWhere.tier).toBe('operational')
    expect(deleteWhere.id).toBeDefined()
  })
})

describe('AuditArchiveService.runArchiveTick — Step B failures', () => {
  it('R2 upload-fail → NO DELETE + AUDIT_ARCHIVE_FAILED audit + admin-notify', async () => {
    const rows = [makeRow({ id: 'r1' })]
    const { service, r2, auditedActions, notified, lastDeleteWhereClauses } =
      makeService({
        operationalRows: rows,
        r2Result: { ok: false, error: 'R2_NOT_CONFIGURED', storageKey: 'k' },
      })

    const result = await service.runArchiveTick()

    expect(r2.uploadAndVerify).toHaveBeenCalledTimes(1)
    expect(result.r2UploadOk).toBe(false)
    expect(result.operationalArchived).toBe(0)
    // No DELETE for operational rows
    const ops = lastDeleteWhereClauses.filter(
      (w) => w.tier === 'operational' && w.id?.in,
    )
    expect(ops).toHaveLength(0)
    // Audit + notify
    expect(auditedActions).toContain('AUDIT_ARCHIVE_FAILED')
    expect(notified).toHaveLength(1)
    expect(notified[0].type).toBe('audit_archive_failed')
  })

  it('AUDIT_ARCHIVE_FAILED is tier=financial (regulatory trail)', async () => {
    const rows = [makeRow({ id: 'r1' })]
    const { service, audit } = makeService({
      operationalRows: rows,
      r2Result: { ok: false, error: 'network', storageKey: 'k' },
    })

    await service.runArchiveTick()

    const failCall = (audit.log as jest.Mock).mock.calls.find(
      (c) => c[0].action === 'AUDIT_ARCHIVE_FAILED',
    )
    expect(failCall[0].tier).toBe('financial')
  })

  it('race detected: DELETE returns count<archived → raceSkipped reported', async () => {
    const rows = [makeRow({ id: 'r1' }), makeRow({ id: 'r2' }), makeRow({ id: 'r3' })]
    const { service, audit } = makeService({
      operationalRows: rows,
      operationalDeleteCount: 2, // 1 row was tier-flipped between SELECT and DELETE
    })

    const result = await service.runArchiveTick()

    expect(result.operationalArchived).toBe(2)
    expect(result.raceSkipped).toBe(1)
    // Audit still records the activity
    const archiveCall = (audit.log as jest.Mock).mock.calls.find(
      (c) => c[0].action === 'AUDIT_ARCHIVE_COMPLETED',
    )
    expect(archiveCall[0].changes.after.raceSkipped).toBe(1)
  })
})

describe('AuditArchiveService.runArchiveTick — empty + idle', () => {
  it('no operational rows → no R2 call, no audit-row, no notify', async () => {
    const { service, r2, audit, notifications } = makeService({
      operationalRows: [],
    })
    const result = await service.runArchiveTick()

    expect(r2.uploadAndVerify).not.toHaveBeenCalled()
    expect((audit.log as jest.Mock)).not.toHaveBeenCalled()
    expect((notifications.createForAllAdmins as jest.Mock)).not.toHaveBeenCalled()
    expect(result.operationalArchived).toBe(0)
    expect(result.r2UploadOk).toBeNull()
  })

  it('no rows at all (Step A=0, Step B=0) → no audit, no notify', async () => {
    const { service, audit, notifications } = makeService({
      ephemeralDeleteCount: 0,
      operationalRows: [],
    })
    await service.runArchiveTick()
    expect((audit.log as jest.Mock)).not.toHaveBeenCalled()
    expect((notifications.createForAllAdmins as jest.Mock)).not.toHaveBeenCalled()
  })
})

describe('AuditArchiveService — Hard-Rule-1: financial NEVER touched', () => {
  it('Step B SELECT NEVER queries tier=financial', async () => {
    const { service, lastFindWhereClauses } = makeService({ operationalRows: [] })
    await service.runArchiveTick()
    for (const where of lastFindWhereClauses) {
      expect(where.tier).not.toBe('financial')
    }
  })

  it('Step A DELETE NEVER queries tier=financial', async () => {
    const { service, lastDeleteWhereClauses } = makeService({ ephemeralDeleteCount: 5 })
    await service.runArchiveTick()
    for (const where of lastDeleteWhereClauses) {
      expect(where.tier).not.toBe('financial')
    }
  })

  it('Step B DELETE NEVER queries tier=financial', async () => {
    const rows = [makeRow({ id: 'r1' })]
    const { service, lastDeleteWhereClauses } = makeService({
      operationalRows: rows,
    })
    await service.runArchiveTick()
    for (const where of lastDeleteWhereClauses) {
      expect(where.tier).not.toBe('financial')
    }
  })
})
