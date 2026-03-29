'use client'

import Image from 'next/image'
import { useState, useRef } from 'react'

interface GalleryImage {
  url: string
  altText?: string
}

interface ImageGalleryProps {
  images: GalleryImage[]
  productName: string
}

export function ImageGallery({ images, productName }: ImageGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [zoomPosition, setZoomPosition] = useState({ x: 50, y: 50 })
  const [isZooming, setIsZooming] = useState(false)
  const mainRef = useRef<HTMLDivElement>(null)

  const activeImage = images[activeIndex] ?? null

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!mainRef.current) return
    const rect = mainRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setZoomPosition({ x, y })
  }

  // Mobile swipe
  const touchStartX = useRef(0)
  const handleTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX }
  const handleTouchEnd = (e: React.TouchEvent) => {
    const diff = touchStartX.current - e.changedTouches[0].clientX
    if (Math.abs(diff) > 50) {
      if (diff > 0 && activeIndex < images.length - 1) setActiveIndex(activeIndex + 1)
      if (diff < 0 && activeIndex > 0) setActiveIndex(activeIndex - 1)
    }
  }

  if (images.length === 0) {
    return (
      <div className="aspect-square rounded-2xl bg-muted flex items-center justify-center">
        <span className="text-4xl font-bold text-muted-foreground/20">{productName.charAt(0).toUpperCase()}</span>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Main Image — priority for LCP */}
      <div
        ref={mainRef}
        className="relative aspect-square rounded-2xl overflow-hidden bg-muted cursor-crosshair"
        onMouseEnter={() => setIsZooming(true)}
        onMouseLeave={() => setIsZooming(false)}
        onMouseMove={handleMouseMove}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {activeImage && (
          <Image
            src={activeImage.url}
            alt={activeImage.altText ?? `${productName} — Bild ${activeIndex + 1}`}
            fill
            priority
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 600px"
            className="object-cover"
            style={
              isZooming
                ? { transform: 'scale(2)', transformOrigin: `${zoomPosition.x}% ${zoomPosition.y}%`, transition: 'transform-origin 0.1s' }
                : undefined
            }
          />
        )}
      </div>

      {/* Thumbnails (Desktop) */}
      {images.length > 1 && (
        <div className="hidden sm:flex gap-2 overflow-x-auto">
          {images.map((img, i) => (
            <button
              key={i}
              onClick={() => setActiveIndex(i)}
              aria-label={`${productName} Bild ${i + 1}`}
              className={`relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 transition-all duration-200 ${
                i === activeIndex ? 'ring-2 ring-accent ring-offset-2' : 'opacity-70 hover:opacity-100'
              }`}
            >
              <Image
                src={img.url}
                alt={img.altText ?? `${productName} Thumbnail ${i + 1}`}
                fill
                sizes="64px"
                className="object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}

      {/* Dots (Mobile) */}
      {images.length > 1 && (
        <div className="flex sm:hidden justify-center gap-2">
          {images.map((_, i) => (
            <button
              key={i}
              onClick={() => setActiveIndex(i)}
              className={`h-2.5 rounded-full transition-all duration-200 ${
                i === activeIndex ? 'w-7 bg-accent' : 'w-2.5 bg-muted-foreground/50'
              }`}
              aria-label={`Bild ${i + 1} von ${images.length}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
