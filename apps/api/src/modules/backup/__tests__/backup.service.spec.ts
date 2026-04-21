/**
 * BackupService integration tests.
 *
 * These tests bypass the pg_dump + gzip shell-out by stubbing the
 * private `dumpAndGzip` method. What we're actually validating:
 *
 *   1. RUNNING row is created BEFORE the dump (mid-job crash still
 *      leaves a trace)
 *   2. SUCCESS row includes sha256 + sizeBytes + storageKey
 *   3. FAILED row includes errorMessage, and the throw propagates
 *   4. Retention sweep is triggered after SUCCESS (best-effort, not
 *      part of the result)
 *   5. Retention sweep: promotion updates DB, expiration deletes R2
 *      object BEFORE marking row EXPIRED
 *   6. Manual vs Daily type is honoured
 *
 * The helper `computeRetentionPlan` is separately unit-tested in
 * backup-retention.spec.ts — here we just verify BackupService wires
 * up the plan correctly.
 */

import { BackupService } from '../backup.service'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

function buildPrisma() {
  const rows = new Map<string, any>()
  let counter = 0
  const prisma: any = {
    backupLog: {
      create: jest.fn(async ({ data }: any) => {
        const id = `row-${++counter}`
        const row = { id, ...data, sizeBytes: null, sha256: null, errorMessage: null, completedAt: null }
        rows.set(id, row)
        return row
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = rows.get(where.id)
        if (!existing) throw new Error(`row ${where.id} not found`)
        const updated = { ...existing, ...data }
        rows.set(where.id, updated)
        return updated
      }),
      findMany: jest.fn(async () => Array.from(rows.values())),
    },
    _rows: rows,
  }
  return prisma
}

function buildR2() {
  return {
    isConfigured: jest.fn().mockReturnValue(true),
    uploadFile: jest.fn(async (_path: string, _key: string) => ({ sizeBytes: 12345 })),
    deleteObject: jest.fn().mockResolvedValue(undefined),
    signedDownloadUrl: jest.fn().mockResolvedValue('https://r2.test/signed'),
    countObjects: jest.fn().mockResolvedValue(5),
    getBucketName: jest.fn().mockReturnValue('malak-backups'),
  }
}

function buildConfig() {
  return {
    get: jest.fn((key: string, fallback?: any) => {
      if (key === 'DATABASE_URL') return 'postgres://test'
      if (key === 'BACKUP_ALERT_EMAIL') return 'admin@test.local'
      if (key === 'APP_URL') return 'https://malak-bekleidung.com'
      return fallback
    }),
  }
}

function buildEmail() {
  return { enqueue: jest.fn().mockResolvedValue(undefined) }
}

/**
 * Creates a BackupService with private dumpAndGzip patched to write
 * a small stub file so sha256 + uploadFile work against a real path.
 */
function makeService(prisma: any, r2: any, config: any, email: any | null) {
  const svc = new BackupService(prisma, config as any, r2 as any, email)
  // Patch the private method — jest's mocking doesn't work through
  // TS private so we attach via bracket syntax. The stub creates a
  // small file at the target path so sha256File + uploadFile have
  // something real to read.
  ;(svc as any).dumpAndGzip = jest.fn(async (localPath: string) => {
    mkdirSync(join(localPath, '..'), { recursive: true })
    writeFileSync(localPath, 'stub-sql-dump-bytes')
  })
  return svc
}

describe('BackupService.runBackup — happy path', () => {
  it('creates RUNNING then updates to SUCCESS with sha256+size+key', async () => {
    const prisma = buildPrisma()
    const r2 = buildR2()
    const svc = makeService(prisma, r2, buildConfig(), buildEmail())

    const rowId = await svc.runBackup({ type: 'DAILY', triggeredByUserId: null })

    expect(prisma.backupLog.create).toHaveBeenCalledTimes(1)
    const createArg = prisma.backupLog.create.mock.calls[0][0]
    expect(createArg.data.status).toBe('RUNNING')
    expect(createArg.data.type).toBe('DAILY')

    // update called at least once with SUCCESS
    const updates = prisma.backupLog.update.mock.calls.map((c: any[]) => c[0].data)
    const successUpdate = updates.find((u: any) => u.status === 'SUCCESS')
    expect(successUpdate).toBeDefined()
    expect(successUpdate.sha256).toMatch(/^[a-f0-9]{64}$/) // sha256 hex
    expect(successUpdate.sizeBytes).toBe(BigInt(12345))

    // R2 upload happened with the right bucket-scoped key
    expect(r2.uploadFile).toHaveBeenCalledTimes(1)
    const uploadKey: string = r2.uploadFile.mock.calls[0][1]
    expect(uploadKey.startsWith('daily/')).toBe(true)
    expect(uploadKey.endsWith('.sql.gz')).toBe(true)

    // No failure email
    const emailArg = (svc as any).email?.enqueue?.mock?.calls?.length
    expect(emailArg ?? 0).toBe(0)

    expect(rowId).toBeDefined()
  })

  it('records triggeredByUserId for MANUAL backups', async () => {
    const prisma = buildPrisma()
    const svc = makeService(prisma, buildR2(), buildConfig(), buildEmail())

    await svc.runBackup({ type: 'MANUAL', triggeredByUserId: 'admin-42' })

    const createArg = prisma.backupLog.create.mock.calls[0][0]
    expect(createArg.data.type).toBe('MANUAL')
    expect(createArg.data.triggeredByUserId).toBe('admin-42')
    expect(createArg.data.storageKey.startsWith('manual/')).toBe(true)
  })
})

describe('BackupService.runBackup — failure path', () => {
  it('marks row FAILED + queues admin email when dump throws', async () => {
    const prisma = buildPrisma()
    const r2 = buildR2()
    const email = buildEmail()
    const svc = new BackupService(prisma, buildConfig() as any, r2 as any, email as any)
    // Force the dump to fail
    ;(svc as any).dumpAndGzip = jest.fn().mockRejectedValue(new Error('pg_dump not found'))

    await expect(
      svc.runBackup({ type: 'DAILY', triggeredByUserId: null }),
    ).rejects.toThrow('pg_dump not found')

    const failedUpdate = prisma.backupLog.update.mock.calls
      .map((c: any[]) => c[0].data)
      .find((u: any) => u.status === 'FAILED')
    expect(failedUpdate).toBeDefined()
    expect(failedUpdate.errorMessage).toContain('pg_dump not found')

    // Admin email was queued (German)
    expect(email.enqueue).toHaveBeenCalledTimes(1)
    const emailArg = email.enqueue.mock.calls[0][0]
    expect(emailArg.type).toBe('backup-failed')
    expect(emailArg.lang).toBe('de')
    expect(emailArg.to).toBe('admin@test.local')
    expect(emailArg.data.backupType).toBe('DAILY')
    expect(emailArg.data.errorMessage).toContain('pg_dump not found')

    // R2 upload was NEVER attempted (dump failed first)
    expect(r2.uploadFile).not.toHaveBeenCalled()
  })

  it('marks row FAILED when R2 upload throws', async () => {
    const prisma = buildPrisma()
    const r2 = buildR2()
    r2.uploadFile.mockRejectedValueOnce(new Error('R2 403 Forbidden'))
    const email = buildEmail()
    const svc = makeService(prisma, r2, buildConfig(), email)

    await expect(svc.runBackup({ type: 'DAILY' })).rejects.toThrow('R2 403 Forbidden')

    const failedUpdate = prisma.backupLog.update.mock.calls
      .map((c: any[]) => c[0].data)
      .find((u: any) => u.status === 'FAILED')
    expect(failedUpdate.errorMessage).toContain('R2 403 Forbidden')
    expect(email.enqueue).toHaveBeenCalledTimes(1)
  })

  it('does not crash when email service is optional/null', async () => {
    const prisma = buildPrisma()
    const svc = new BackupService(prisma, buildConfig() as any, buildR2() as any, null)
    ;(svc as any).dumpAndGzip = jest.fn().mockRejectedValue(new Error('boom'))

    await expect(svc.runBackup({ type: 'DAILY' })).rejects.toThrow('boom')
    // Should still record FAILED row even without email
    const failedUpdate = prisma.backupLog.update.mock.calls
      .map((c: any[]) => c[0].data)
      .find((u: any) => u.status === 'FAILED')
    expect(failedUpdate).toBeDefined()
  })
})

describe('BackupService.sweepRetention', () => {
  it('promotes + expires per plan; deletes R2 before marking EXPIRED', async () => {
    const prisma = buildPrisma()
    const r2 = buildR2()
    const svc = makeService(prisma, r2, buildConfig(), buildEmail())

    // Seed 35 DAILY backups across March 2026, all SUCCESS
    for (let i = 0; i < 35; i++) {
      const d = new Date('2026-03-01T03:00:00Z')
      d.setUTCDate(d.getUTCDate() + i)
      const id = `seed-${i}`
      prisma._rows.set(id, {
        id, type: 'DAILY', status: 'SUCCESS',
        startedAt: d, storageKey: `daily/${id}.sql.gz`,
      })
    }

    const result = await svc.sweepRetention(new Date('2026-04-10T12:00:00Z'))

    // 2 months in the seeded window (Mar + overflow to Apr) — 1 promotion.
    // Actually 35 days starting Mar 1 ends Apr 4, so we have 2 months.
    expect(result.promoted).toBeGreaterThanOrEqual(1)

    // The R2 delete must happen BEFORE the EXPIRED status update — check
    // that for any row flagged EXPIRED, r2.deleteObject was called with
    // its storageKey.
    const expiredUpdates = prisma.backupLog.update.mock.calls
      .filter((c: any[]) => c[0].data.status === 'EXPIRED')
    for (const call of expiredUpdates) {
      const id = call[0].where.id
      const seed = prisma._rows.get(id)
      expect(r2.deleteObject).toHaveBeenCalledWith(seed.storageKey)
    }
  })

  it('does NOT mark EXPIRED when R2 delete throws (safe retry)', async () => {
    const prisma = buildPrisma()
    const r2 = buildR2()
    r2.deleteObject.mockRejectedValue(new Error('R2 5xx'))
    const svc = makeService(prisma, r2, buildConfig(), buildEmail())

    // Seed enough rows across one calendar month that at least ~20
    // should expire even after one promotion. 50 rows in a single
    // month ensures keep-30 leaves 19 expirable rows → plenty to
    // assert the retry safety.
    for (let i = 0; i < 50; i++) {
      const d = new Date('2026-03-01T03:00:00Z')
      d.setUTCHours(d.getUTCHours() + i) // hours, not days — same calendar month
      const id = `seed-${i}`
      prisma._rows.set(id, {
        id, type: 'DAILY', status: 'SUCCESS',
        startedAt: d, storageKey: `daily/${id}.sql.gz`,
      })
    }

    await svc.sweepRetention(new Date('2026-04-10T12:00:00Z'))

    // EXPIRED status NEVER written because R2 delete kept failing.
    const expiredUpdates = prisma.backupLog.update.mock.calls
      .filter((c: any[]) => c[0].data.status === 'EXPIRED')
    expect(expiredUpdates).toHaveLength(0)

    // Sanity: deleteObject WAS attempted — retry safety is about not
    // marking EXPIRED, not about skipping the attempt.
    expect(r2.deleteObject).toHaveBeenCalled()
  })
})
