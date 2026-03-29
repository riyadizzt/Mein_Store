import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import sharp from 'sharp'

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name)
  private supabase!: SupabaseClient
  private readonly bucket = 'product-images'

  async onModuleInit() {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!url || !key) {
      this.logger.warn('Supabase Storage nicht konfiguriert — SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY fehlt')
      return
    }

    this.supabase = createClient(url, key)

    // Ensure bucket exists
    const { data: buckets } = await this.supabase.storage.listBuckets()
    const exists = buckets?.some((b) => b.name === this.bucket)

    if (!exists) {
      const { error } = await this.supabase.storage.createBucket(this.bucket, {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024, // 10MB
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      })
      if (error) this.logger.error(`Bucket-Erstellung fehlgeschlagen: ${error.message}`)
      else this.logger.log(`Bucket "${this.bucket}" erstellt`)
    }
  }

  /**
   * Upload a product image.
   * Optimizes to WebP, creates thumbnail.
   * Returns { url, thumbnailUrl }
   */
  async uploadProductImage(
    productId: string,
    file: Buffer,
    filename: string,
    colorName?: string,
  ): Promise<{ url: string; thumbnailUrl: string }> {
    const timestamp = Date.now()
    const safeName = filename.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/\.[^.]+$/, '')
    const folder = colorName
      ? `products/${productId}/${colorName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`
      : `products/${productId}/general`

    // Optimize main image → WebP, max 800px (fast LCP)
    const mainBuffer = await sharp(file)
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer()

    // Thumbnail → 300px (for grids/cards)
    const thumbBuffer = await sharp(file)
      .resize(300, 300, { fit: 'cover' })
      .webp({ quality: 70 })
      .toBuffer()

    const mainPath = `${folder}/${safeName}_${timestamp}.webp`
    const thumbPath = `${folder}/${safeName}_${timestamp}_thumb.webp`

    // Upload both
    const [mainResult, thumbResult] = await Promise.all([
      this.supabase.storage.from(this.bucket).upload(mainPath, mainBuffer, {
        contentType: 'image/webp',
        upsert: true,
      }),
      this.supabase.storage.from(this.bucket).upload(thumbPath, thumbBuffer, {
        contentType: 'image/webp',
        upsert: true,
      }),
    ])

    if (mainResult.error) throw new Error(`Upload failed: ${mainResult.error.message}`)
    if (thumbResult.error) this.logger.warn(`Thumbnail upload failed: ${thumbResult.error.message}`)

    const { data: mainUrl } = this.supabase.storage.from(this.bucket).getPublicUrl(mainPath)
    const { data: thumbUrl } = this.supabase.storage.from(this.bucket).getPublicUrl(thumbPath)

    return {
      url: mainUrl.publicUrl,
      thumbnailUrl: thumbUrl.publicUrl,
    }
  }

  /**
   * Upload a user avatar.
   * Crops to square 400x400.
   */
  async uploadAvatar(userId: string, file: Buffer): Promise<string> {
    const buffer = await sharp(file)
      .resize(400, 400, { fit: 'cover' })
      .webp({ quality: 80 })
      .toBuffer()

    const path = `avatars/${userId}/profile.webp`

    const { error } = await this.supabase.storage.from(this.bucket).upload(path, buffer, {
      contentType: 'image/webp',
      upsert: true,
    })

    if (error) throw new Error(`Avatar upload failed: ${error.message}`)

    const { data } = this.supabase.storage.from(this.bucket).getPublicUrl(path)
    return data.publicUrl
  }

  /**
   * Delete an image from storage.
   */
  async deleteImage(url: string): Promise<void> {
    if (!url || !this.supabase) return

    // Extract path from URL
    const match = url.match(/\/storage\/v1\/object\/public\/[^/]+\/(.+)$/)
    if (!match) return

    const path = match[1]
    await this.supabase.storage.from(this.bucket).remove([path])

    // Also try to delete thumbnail
    const thumbPath = path.replace('.webp', '_thumb.webp')
    await this.supabase.storage.from(this.bucket).remove([thumbPath]).catch(() => {})
  }
}
