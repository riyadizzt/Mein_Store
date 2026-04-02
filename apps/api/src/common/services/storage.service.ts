import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { randomUUID } from 'crypto'

// ── Types ─────────────────────────────────────────────────

export interface ImageUploadResult {
  r2Path: string
  url: string         // Main ImageKit URL (for DB storage)
  thumbnail: string   // 300x300
  card: string        // 600x600
  full: string        // 1200x1200
  zoom: string        // 2000x2000
}

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

// ── Service ───────────────────────────────────────────────

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name)

  // Cloudflare R2 (images)
  private r2!: S3Client
  private r2Bucket!: string
  private imagekitUrl!: string

  // Supabase (invoices — stays on Supabase for DSGVO)
  private supabase!: SupabaseClient
  private readonly invoiceBucket = 'invoices'

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    // ── Init Cloudflare R2 ──
    const r2Endpoint = this.config.get('R2_ENDPOINT')
    const r2AccessKey = this.config.get('R2_ACCESS_KEY_ID')
    const r2SecretKey = this.config.get('R2_SECRET_ACCESS_KEY')
    this.r2Bucket = this.config.get('R2_BUCKET_NAME', 'malak-products')
    this.imagekitUrl = this.config.get('IMAGEKIT_URL_ENDPOINT', 'https://ik.imagekit.io/malakbekleidung')

    if (r2Endpoint && r2AccessKey && r2SecretKey) {
      this.r2 = new S3Client({
        region: 'auto',
        endpoint: r2Endpoint,
        forcePathStyle: true,
        credentials: {
          accessKeyId: r2AccessKey,
          secretAccessKey: r2SecretKey,
        },
      })
      this.logger.log('Cloudflare R2 initialized')
    } else {
      this.logger.warn('Cloudflare R2 not configured — R2_ENDPOINT, R2_ACCESS_KEY_ID or R2_SECRET_ACCESS_KEY missing')
    }

    // ── Init Supabase (invoices only) ──
    const supabaseUrl = this.config.get('SUPABASE_URL')
    const supabaseKey = this.config.get('SUPABASE_SERVICE_ROLE_KEY')

    if (supabaseUrl && supabaseKey) {
      this.supabase = createClient(supabaseUrl, supabaseKey)

      // Ensure invoice bucket exists
      const { data: buckets } = await this.supabase.storage.listBuckets()
      if (!buckets?.some((b) => b.name === this.invoiceBucket)) {
        const { error } = await this.supabase.storage.createBucket(this.invoiceBucket, {
          public: false,
          fileSizeLimit: 5 * 1024 * 1024,
          allowedMimeTypes: ['application/pdf'],
        })
        if (error) this.logger.error(`Invoice bucket creation failed: ${error.message}`)
        else this.logger.log(`Private bucket "${this.invoiceBucket}" created`)
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // ██ IMAGE UPLOADS (Cloudflare R2 + ImageKit CDN)
  // ══════════════════════════════════════════════════════════

  /**
   * Upload a single image to Cloudflare R2.
   * Returns ImageKit URLs for all sizes.
   */
  async uploadImage(file: { buffer: Buffer; mimetype: string; originalname: string }, folder: string): Promise<ImageUploadResult> {
    this.validateImage(file)

    // Optimize: resize to max 1200px, convert to JPEG 85%
    const optimized = await sharp(file.buffer)
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer()

    // Generate unique filename
    const id = randomUUID().slice(0, 12)
    const r2Path = `${folder}/${id}-${Date.now()}.jpg`

    // Upload to R2
    await this.r2.send(new PutObjectCommand({
      Bucket: this.r2Bucket,
      Key: r2Path,
      Body: optimized,
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    }))

    this.logger.log(`Image uploaded to R2: ${r2Path} (${(optimized.length / 1024).toFixed(0)}KB)`)

    return {
      r2Path,
      url: this.buildUrl(r2Path),
      thumbnail: this.buildUrl(r2Path, 300, 300),
      card: this.buildUrl(r2Path, 600, 600),
      full: this.buildUrl(r2Path, 1200, 1200),
      zoom: this.buildUrl(r2Path, 2000, 2000),
    }
  }

  /**
   * Upload multiple images in parallel (max 5).
   */
  async uploadMultiple(files: Array<{ buffer: Buffer; mimetype: string; originalname: string }>, folder: string): Promise<ImageUploadResult[]> {
    const batch = files.slice(0, 5)
    return Promise.all(batch.map((f) => this.uploadImage(f, folder)))
  }

  /**
   * Upload a product image — convenience wrapper.
   * Returns { url, thumbnailUrl } for backward compatibility.
   */
  async uploadProductImage(
    productId: string,
    file: Buffer,
    filename: string,
    colorName?: string,
  ): Promise<{ url: string; thumbnailUrl: string }> {
    const folder = colorName
      ? `products/${productId}/${colorName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`
      : `products/${productId}`

    const result = await this.uploadImage(
      { buffer: file, mimetype: 'image/jpeg', originalname: filename },
      folder,
    )

    return {
      url: result.url,
      thumbnailUrl: result.thumbnail,
    }
  }

  /**
   * Upload a user avatar.
   */
  async uploadAvatar(userId: string, file: Buffer): Promise<string> {
    const optimized = await sharp(file)
      .resize(400, 400, { fit: 'cover' })
      .jpeg({ quality: 85 })
      .toBuffer()

    const r2Path = `avatars/${userId}-${Date.now()}.jpg`

    await this.r2.send(new PutObjectCommand({
      Bucket: this.r2Bucket,
      Key: r2Path,
      Body: optimized,
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=86400',
    }))

    return this.buildUrl(r2Path, 400, 400)
  }

  /**
   * Delete an image from R2.
   * Accepts R2 path OR ImageKit URL.
   */
  async deleteImage(r2PathOrUrl: string): Promise<void> {
    if (!r2PathOrUrl || !this.r2) return

    let r2Path = r2PathOrUrl

    // Extract R2 path from ImageKit URL
    if (r2PathOrUrl.includes('ik.imagekit.io')) {
      const urlPath = new URL(r2PathOrUrl).pathname
      // Remove /malakbekleidung/ prefix
      const parts = urlPath.split('/').slice(2)
      r2Path = parts.join('/')
      // Remove query params from path
      r2Path = r2Path.split('?')[0]
    }

    // Also handle old Supabase URLs gracefully
    if (r2PathOrUrl.includes('supabase.co')) {
      this.logger.debug(`Skipping delete for Supabase URL: ${r2PathOrUrl}`)
      return
    }

    try {
      await this.r2.send(new DeleteObjectCommand({
        Bucket: this.r2Bucket,
        Key: r2Path,
      }))
      this.logger.log(`Deleted from R2: ${r2Path}`)
    } catch (err: any) {
      this.logger.warn(`R2 delete failed for ${r2Path}: ${err.message}`)
    }
  }

  // ── ImageKit URL Builder ──────────────────────────────────

  private buildUrl(r2Path: string, width?: number, height?: number): string {
    const base = `${this.imagekitUrl}/${r2Path}`
    if (!width && !height) return `${base}?tr=f-auto,q-85`
    return `${base}?tr=w-${width},h-${height},f-auto,q-85`
  }

  // ── Validation ────────────────────────────────────────────

  private validateImage(file: { buffer: Buffer; mimetype: string; originalname: string }): void {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      throw new BadRequestException({
        message: {
          de: `Ungültiges Bildformat. Erlaubt: JPG, PNG, WebP, GIF`,
          en: `Invalid image format. Allowed: JPG, PNG, WebP, GIF`,
          ar: `تنسيق صورة غير صالح. المسموح: JPG, PNG, WebP, GIF`,
        },
      })
    }
    if (file.buffer.length > MAX_FILE_SIZE) {
      throw new BadRequestException({
        message: {
          de: `Bild zu groß (max. ${MAX_FILE_SIZE / 1024 / 1024}MB)`,
          en: `Image too large (max. ${MAX_FILE_SIZE / 1024 / 1024}MB)`,
          ar: `الصورة كبيرة جداً (الحد الأقصى ${MAX_FILE_SIZE / 1024 / 1024}MB)`,
        },
      })
    }
  }

  // ══════════════════════════════════════════════════════════
  // ██ INVOICE PDFs (stays on Supabase — private, DSGVO)
  // ══════════════════════════════════════════════════════════

  async uploadInvoicePdf(invoiceNumber: string, buffer: Buffer): Promise<{ path: string; signedUrl: string }> {
    const year = invoiceNumber.split('-')[1] || new Date().getFullYear().toString()
    const path = `${year}/${invoiceNumber}.pdf`

    const { error } = await this.supabase.storage.from(this.invoiceBucket).upload(path, buffer, {
      contentType: 'application/pdf',
      upsert: true,
    })
    if (error) throw new Error(`Invoice PDF upload failed: ${error.message}`)

    const { data } = await this.supabase.storage.from(this.invoiceBucket).createSignedUrl(path, 3600)
    this.logger.log(`Invoice PDF uploaded: ${path}`)
    return { path, signedUrl: data?.signedUrl ?? '' }
  }

  async getInvoiceSignedUrl(storagePath: string, expiresInSeconds = 3600): Promise<string> {
    const { data, error } = await this.supabase.storage.from(this.invoiceBucket).createSignedUrl(storagePath, expiresInSeconds)
    if (error) throw new Error(`Signed URL generation failed: ${error.message}`)
    return data.signedUrl
  }

  async downloadInvoicePdf(storagePath: string): Promise<Buffer> {
    const { data, error } = await this.supabase.storage.from(this.invoiceBucket).download(storagePath)
    if (error) throw new Error(`Invoice PDF download failed: ${error.message}`)
    const arrayBuffer = await data.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }
}
