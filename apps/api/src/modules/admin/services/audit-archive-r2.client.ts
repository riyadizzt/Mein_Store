/**
 * Thin R2 client dedicated to the audit-archive bucket (C15.1).
 *
 * Intentionally separate from BackupR2Client + StorageService because:
 *   - Different bucket (malak-audit-archive vs malak-backups vs
 *     malak-products) — clean data-class separation.
 *   - Different access keys = separate blast-radius if one credential
 *     leaks.
 *   - Optional R2-side WORM/Object-Lock could be enabled on this
 *     bucket alone for regulatory grade (operator decision).
 *
 * Graceful degradation: if env vars are missing, the cron logs the
 * config-miss + writes AUDIT_ARCHIVE_FAILED audit-row + admin-notify.
 * It does NOT crash the process — same pattern as BackupR2Client.
 *
 * Mirror of apps/api/src/modules/backup/backup-r2.client.ts. Copy
 * (rather than extract a base class) is intentional: each bucket
 * carries its own credentials and lifecycle.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'

export interface UploadResult {
  ok: true
  sizeBytes: number
  storageKey: string
}

export interface UploadFailure {
  ok: false
  error: string
  storageKey: string
}

@Injectable()
export class AuditArchiveR2Client implements OnModuleInit {
  private readonly logger = new Logger(AuditArchiveR2Client.name)
  private client: S3Client | null = null
  private bucket!: string

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const endpoint = this.config.get<string>('R2_AUDIT_ENDPOINT')
      ?? this.config.get<string>('R2_BACKUP_ENDPOINT')
      ?? this.config.get<string>('R2_ENDPOINT')
    const accessKeyId = this.config.get<string>('R2_AUDIT_ACCESS_KEY_ID')
    const secretAccessKey = this.config.get<string>('R2_AUDIT_SECRET_ACCESS_KEY')
    this.bucket = this.config.get<string>('R2_AUDIT_BUCKET', 'malak-audit-archive')

    if (endpoint && accessKeyId && secretAccessKey) {
      this.client = new S3Client({
        region: 'auto',
        endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
      })
      this.logger.log(
        `Audit-archive R2 client initialised (bucket=${this.bucket})`,
      )
    } else {
      this.logger.warn(
        'Audit-archive R2 client NOT configured — set R2_AUDIT_BUCKET + R2_AUDIT_ACCESS_KEY_ID + R2_AUDIT_SECRET_ACCESS_KEY before deploy',
      )
    }
  }

  isConfigured(): boolean {
    return this.client !== null
  }

  getBucketName(): string {
    return this.bucket
  }

  /**
   * Upload + verify upload-success via HEAD-roundtrip.
   *
   * Returns { ok:true } only after BOTH:
   *   1. PUT command succeeds (no thrown error)
   *   2. HEAD request returns ContentLength matching the body size
   *
   * Why HEAD-verify: a successful PUT response from some S3-compatible
   * stores is buffered and the actual write to disk can fail silently.
   * HEAD-after-PUT round-trip catches those silent failures BEFORE
   * we DELETE the source rows.
   */
  async uploadAndVerify(
    storageKey: string,
    body: Buffer,
    contentType = 'application/gzip',
  ): Promise<UploadResult | UploadFailure> {
    if (!this.client) {
      return {
        ok: false,
        error: 'R2_NOT_CONFIGURED',
        storageKey,
      }
    }
    try {
      // 1. PUT
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: storageKey,
          Body: body,
          ContentType: contentType,
          ContentLength: body.length,
        }),
      )

      // 2. HEAD-verify — actual size matches and > 0
      const head = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: storageKey,
        }),
      )
      const remoteSize = head.ContentLength ?? 0
      if (remoteSize === 0) {
        return {
          ok: false,
          error: `HEAD verify: zero-byte object`,
          storageKey,
        }
      }
      if (remoteSize !== body.length) {
        return {
          ok: false,
          error: `HEAD verify: size mismatch local=${body.length} remote=${remoteSize}`,
          storageKey,
        }
      }
      return { ok: true, sizeBytes: remoteSize, storageKey }
    } catch (e: any) {
      return {
        ok: false,
        error: (e?.message ?? String(e)).slice(0, 500),
        storageKey,
      }
    }
  }
}
