/**
 * ImageKit URL helper for frontend image optimization.
 *
 * New images: https://ik.imagekit.io/malakbekleidung/products/abc.jpg?tr=w-300,h-300,f-auto,q-85
 * Old images (Supabase): returned as-is for backward compatibility
 */

const IMAGEKIT_URL = process.env.NEXT_PUBLIC_IMAGEKIT_URL || 'https://ik.imagekit.io/malakbekleidung'

interface ImageOptions {
  width?: number
  height?: number
  quality?: number
  fit?: 'cover' | 'contain' | 'fill'
}

/**
 * Get an optimized image URL.
 * - ImageKit URLs → adds transform parameters
 * - Supabase URLs → returns unchanged (backward compat)
 * - Null/empty → returns empty string
 */
export function getImageUrl(url: string | null | undefined, options?: ImageOptions): string {
  if (!url) return ''

  // Old Supabase URLs → return as-is
  if (url.includes('supabase.co')) return url

  // Already an ImageKit URL → add transforms
  if (url.includes('ik.imagekit.io')) {
    const base = url.split('?')[0]
    return buildTransform(base, options)
  }

  // Relative path (R2 path) → build full ImageKit URL
  if (!url.startsWith('http')) {
    return buildTransform(`${IMAGEKIT_URL}/${url}`, options)
  }

  return url
}

function buildTransform(base: string, options?: ImageOptions): string {
  const parts: string[] = ['f-auto']
  if (options?.width) parts.push(`w-${options.width}`)
  if (options?.height) parts.push(`h-${options.height}`)
  parts.push(`q-${options?.quality ?? 85}`)
  if (options?.fit === 'cover') parts.push('c-maintain_ratio')
  return `${base}?tr=${parts.join(',')}`
}

// ── Preset Functions ──────────────────────────────────────

/** 300x300 — Grid/List thumbnails */
export function getThumbnail(url: string | null | undefined): string {
  return getImageUrl(url, { width: 300, height: 300, fit: 'cover' })
}

/** 600x600 — Product cards */
export function getCardImage(url: string | null | undefined): string {
  return getImageUrl(url, { width: 600, height: 600 })
}

/** 1200x1200 — Product detail page */
export function getFullImage(url: string | null | undefined): string {
  return getImageUrl(url, { width: 1200, height: 1200 })
}

/** 2000x2000 — Zoom view */
export function getZoomImage(url: string | null | undefined): string {
  return getImageUrl(url, { width: 2000, height: 2000, quality: 90 })
}
