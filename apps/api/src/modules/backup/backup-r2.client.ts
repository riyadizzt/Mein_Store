/**
 * Thin R2 client dedicated to the backup bucket.
 *
 * Intentionally separate from StorageService (which handles image
 * uploads + invoice PDFs) because:
 *   - different bucket (malak-backups vs malak-products)
 *   - different access keys may be used (separate R2 API token with
 *     tighter permissions is recommended, but not required)
 *   - failure of one bucket should not take down the other
 *
 * Graceful degradation: if the env vars are missing, the cron just
 * logs and skips — it does not crash the process.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'

@Injectable()
export class BackupR2Client implements OnModuleInit {
  private readonly logger = new Logger(BackupR2Client.name)
  private client: S3Client | null = null
  private bucket!: string

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    // Separate env var so the operator can point the backup bucket at a
    // different R2 account or a different region without affecting the
    // image bucket.
    const endpoint = this.config.get<string>('R2_BACKUP_ENDPOINT')
      ?? this.config.get<string>('R2_ENDPOINT')
    const accessKeyId = this.config.get<string>('R2_BACKUP_ACCESS_KEY_ID')
      ?? this.config.get<string>('R2_ACCESS_KEY_ID')
    const secretAccessKey = this.config.get<string>('R2_BACKUP_SECRET_ACCESS_KEY')
      ?? this.config.get<string>('R2_SECRET_ACCESS_KEY')
    this.bucket = this.config.get<string>('R2_BACKUP_BUCKET', 'malak-backups')

    if (endpoint && accessKeyId && secretAccessKey) {
      this.client = new S3Client({
        region: 'auto',
        endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
      })
      this.logger.log(`Backup R2 client initialised (bucket=${this.bucket})`)
    } else {
      this.logger.warn('Backup R2 client NOT configured — backups will fail until R2_BACKUP_* env is set')
    }
  }

  isConfigured(): boolean {
    return this.client !== null
  }

  getBucketName(): string {
    return this.bucket
  }

  /**
   * Upload a local file (the pg_dump output) to R2.
   * Throws if R2 is not configured.
   */
  async uploadFile(localPath: string, storageKey: string, contentType = 'application/gzip'): Promise<{ sizeBytes: number }> {
    if (!this.client) throw new Error('R2_NOT_CONFIGURED')
    const size = (await stat(localPath)).size
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      Body: createReadStream(localPath),
      ContentType: contentType,
      ContentLength: size,
    }))
    return { sizeBytes: size }
  }

  async deleteObject(storageKey: string): Promise<void> {
    if (!this.client) throw new Error('R2_NOT_CONFIGURED')
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    }))
  }

  /**
   * Generate a signed GET URL with a short TTL (default 15 min) for
   * direct-from-browser downloads. The admin UI uses this to offer
   * one-click download without proxying the dump through the API.
   */
  async signedDownloadUrl(storageKey: string, ttlSeconds = 900): Promise<string> {
    if (!this.client) throw new Error('R2_NOT_CONFIGURED')
    // Cast around an @smithy/types sub-version mismatch between the
    // client-s3 (4.13.x) and s3-request-presigner (transitively pulls
    // 4.14.x). Runtime behaviour is identical; only the structural
    // typing differs. See package.json `pnpm.overrides` for context.
    return getSignedUrl(
      this.client as any,
      new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }) as any,
      { expiresIn: ttlSeconds },
    )
  }

  /**
   * Sanity-check helper used by the /admin/backups health indicator
   * (not by the cron path). Returns the number of objects in the
   * bucket, capped at 1000.
   */
  async countObjects(): Promise<number> {
    if (!this.client) return 0
    const res = await this.client.send(new ListObjectsV2Command({
      Bucket: this.bucket,
      MaxKeys: 1000,
    }))
    return res.KeyCount ?? 0
  }
}
