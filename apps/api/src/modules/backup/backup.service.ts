/**
 * BackupService — orchestrates pg_dump + SHA256 + R2 upload + retention.
 *
 * Design notes:
 *   - pg_dump is invoked via `child_process.spawn('pg_dump', ...)` piped
 *     through `gzip`. The runtime image must have `postgresql-client`
 *     installed — see apps/api/Dockerfile (Runner stage does
 *     `apk add --no-cache postgresql-client gzip`). Without it every
 *     backup fails with ENOENT. See admin runbook.
 *   - SHA256 is computed by streaming the local dump file a second
 *     time (memory-safe even for multi-GB dumps).
 *   - On FAILURE: explicit Sentry.captureException + admin email.
 *   - On SUCCESS: retention sweep runs as a best-effort — a failure
 *     there is logged but does not fail the parent job.
 *   - All BackupLog writes go through a single helper so the "RUNNING"
 *     row is created first and then PATCHED with the final state.
 *     This guarantees a crash mid-job still leaves a trace.
 */
import { Injectable, Logger, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import { EmailService } from '../email/email.service'
import { BackupR2Client } from './backup-r2.client'
import { computeRetentionPlan, type BackupRowSnapshot, type BackupTypeLite } from '../../common/helpers/backup-retention'
import * as Sentry from '@sentry/nestjs'
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { createReadStream, createWriteStream } from 'fs'
import { unlink, mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

type RunBackupOptions = {
  type: BackupTypeLite
  triggeredByUserId?: string | null
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly r2: BackupR2Client,
    @Optional() private readonly email: EmailService | null,
  ) {}

  // ══════════════════════════════════════════════════════════
  // ██ PUBLIC API
  // ══════════════════════════════════════════════════════════

  /**
   * Execute one backup end-to-end. Returns the BackupLog row id.
   * Emits Sentry + email alert on failure.
   */
  async runBackup(opts: RunBackupOptions): Promise<string> {
    const startedAt = new Date()
    const storageKey = this.makeStorageKey(opts.type, startedAt)

    // Persist RUNNING row up-front so a mid-job crash still leaves a trace.
    const row = await this.prisma.backupLog.create({
      data: {
        type: opts.type,
        status: 'RUNNING',
        startedAt,
        storageKey,
        triggeredByUserId: opts.triggeredByUserId ?? null,
      },
    })

    let tmpDir: string | null = null
    try {
      tmpDir = await mkdtemp(join(tmpdir(), 'malak-backup-'))
      const localPath = join(tmpDir, 'dump.sql.gz')

      // 1. Dump + gzip
      await this.dumpAndGzip(localPath)

      // 2. SHA256
      const sha256 = await this.sha256File(localPath)

      // 3. Upload
      if (!this.r2.isConfigured()) {
        throw new Error('R2_NOT_CONFIGURED — set R2_BACKUP_* env vars')
      }
      const { sizeBytes } = await this.r2.uploadFile(localPath, storageKey)

      // 4. Mark SUCCESS
      await this.prisma.backupLog.update({
        where: { id: row.id },
        data: {
          status: 'SUCCESS',
          completedAt: new Date(),
          sizeBytes: BigInt(sizeBytes),
          sha256,
        },
      })
      this.logger.log(`Backup SUCCESS (${opts.type}) — ${storageKey} | ${sizeBytes}B | sha256=${sha256.slice(0, 12)}…`)

      // 5. Retention sweep (best-effort)
      this.sweepRetention().catch((err) => {
        this.logger.error(`Retention sweep failed (non-fatal): ${err.message}`)
        Sentry.captureException(err, { tags: { feature: 'backup-retention' } })
      })

      return row.id
    } catch (err: any) {
      const message = err?.message ?? String(err)
      this.logger.error(`Backup FAILED (${opts.type}): ${message}`)
      await this.prisma.backupLog.update({
        where: { id: row.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: message.slice(0, 2000),
        },
      }).catch(() => {})

      // Sentry + email alert. Never re-throw from here — the caller
      // (cron or controller) already knows the result via the DB row.
      Sentry.captureException(err instanceof Error ? err : new Error(message), {
        tags: { feature: 'backup', backupType: opts.type },
      })
      await this.notifyFailure(opts.type, message).catch(() => {})
      throw err
    } finally {
      if (tmpDir) {
        await unlink(join(tmpDir, 'dump.sql.gz')).catch(() => {})
      }
    }
  }

  /**
   * Retention sweep — applies the pure helper's action plan to DB + R2.
   * Called after each successful backup, and exposed for manual trigger.
   */
  async sweepRetention(now: Date = new Date()): Promise<{ expired: number; promoted: number }> {
    const rows = await this.prisma.backupLog.findMany({
      where: { status: 'SUCCESS' },
      select: { id: true, type: true, startedAt: true, storageKey: true },
    })
    const plan = computeRetentionPlan(
      rows.map((r): BackupRowSnapshot => ({
        id: r.id,
        type: r.type as BackupTypeLite,
        startedAt: r.startedAt,
        storageKey: r.storageKey,
      })),
      now,
    )

    // Promote DAILY→MONTHLY (R2 object stays, DB row re-tagged).
    for (const p of plan.toPromote) {
      await this.prisma.backupLog.update({
        where: { id: p.id },
        data: { type: 'MONTHLY' },
      })
    }

    // Expire: delete R2 object then mark DB row EXPIRED. Order matters
    // — if R2 delete fails, we keep the row flagged as SUCCESS so the
    // next sweep retries.
    for (const e of plan.toExpire) {
      if (e.storageKey) {
        try {
          await this.r2.deleteObject(e.storageKey)
        } catch (err: any) {
          this.logger.warn(`R2 delete failed for ${e.storageKey}: ${err.message} — leaving row as SUCCESS`)
          continue
        }
      }
      await this.prisma.backupLog.update({
        where: { id: e.id },
        data: { status: 'EXPIRED' },
      })
    }

    return { expired: plan.toExpire.length, promoted: plan.toPromote.length }
  }

  // ══════════════════════════════════════════════════════════
  // ██ INTERNAL HELPERS
  // ══════════════════════════════════════════════════════════

  /**
   * Shell out to pg_dump | gzip → localPath. Throws on non-zero exit.
   */
  private async dumpAndGzip(localPath: string): Promise<void> {
    const dbUrl = this.config.get<string>('DATABASE_URL')
    if (!dbUrl) throw new Error('DATABASE_URL_NOT_SET')

    return new Promise<void>((resolve, reject) => {
      // -Fc (custom format) would be smaller+more flexible for
      // pg_restore, but plain + gzip is the simplest cross-version
      // pattern and works with `psql < dump.sql` too — the runbook
      // shows both restore options.
      const pgDump = spawn('pg_dump', [
        '--no-owner',        // don't include ALTER OWNER (restores work on any target)
        '--no-acl',          // skip GRANT/REVOKE
        '--format=plain',
        dbUrl,
      ], { stdio: ['ignore', 'pipe', 'pipe'] })

      const gzip = spawn('gzip', ['-9'], { stdio: ['pipe', 'pipe', 'pipe'] })
      const out = createWriteStream(localPath)

      pgDump.stdout.pipe(gzip.stdin)
      gzip.stdout.pipe(out)

      let pgErr = ''
      let gzipErr = ''
      pgDump.stderr.on('data', (chunk) => { pgErr += chunk.toString() })
      gzip.stderr.on('data', (chunk) => { gzipErr += chunk.toString() })

      const fail = (origin: string, code: number | null, msg = '') => {
        reject(new Error(`${origin} exited with code ${code}: ${msg.trim() || '(no stderr)'}`))
      }

      pgDump.on('error', (err) => reject(new Error(`pg_dump spawn failed: ${err.message}`)))
      gzip.on('error', (err) => reject(new Error(`gzip spawn failed: ${err.message}`)))

      pgDump.on('exit', (code) => {
        if (code !== 0) return fail('pg_dump', code, pgErr)
      })
      gzip.on('exit', (code) => {
        if (code !== 0) return fail('gzip', code, gzipErr)
      })
      out.on('error', reject)
      out.on('finish', () => resolve())
    })
  }

  /** Stream the file through sha256 — memory-safe for multi-GB dumps. */
  private async sha256File(path: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const hash = createHash('sha256')
      const stream = createReadStream(path)
      stream.on('error', reject)
      stream.on('data', (chunk) => hash.update(chunk))
      stream.on('end', () => resolve(hash.digest('hex')))
    })
  }

  /**
   * Build a stable R2 object key: `<type>/<ISO-date>.sql.gz`.
   * Colons are replaced with dashes so the key works on any filesystem
   * the admin might later `rclone copy` the backup onto.
   */
  private makeStorageKey(type: BackupTypeLite, startedAt: Date): string {
    const iso = startedAt.toISOString().replace(/[:]/g, '-').replace(/\.\d{3}/, '')
    const prefix = type.toLowerCase()
    return `${prefix}/${iso}.sql.gz`
  }

  /**
   * Send a German failure email to the configured admin address.
   * Silent-ignore if EmailService is not wired or no recipient set.
   */
  private async notifyFailure(type: BackupTypeLite, errorMessage: string): Promise<void> {
    if (!this.email) return
    const to = this.config.get<string>('BACKUP_ALERT_EMAIL')
      ?? this.config.get<string>('EMAIL_FROM_ADMIN')
    if (!to) {
      this.logger.warn('BACKUP_ALERT_EMAIL not set — skipping failure email')
      return
    }
    await this.email.enqueue({
      to,
      type: 'backup-failed' as any, // registered in email.constants additive extension below
      lang: 'de',
      data: {
        backupType: type,
        errorMessage: errorMessage.slice(0, 1000),
        timestampStr: new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }),
        dashboardUrl: `${this.config.get('APP_URL', 'https://malak-bekleidung.com')}/de/admin/backups`,
      },
    })
  }
}
