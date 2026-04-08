'use client'

import Image from 'next/image'
import { useState, useRef, useCallback } from 'react'
import { AnimatePresence, motion } from 'motion/react'

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
  const [hasInteracted, setHasInteracted] = useState(false)
  const [direction, setDirection] = useState(0) // -1 = prev, 1 = next
  const [zoomPosition, setZoomPosition] = useState({ x: 50, y: 50 })
  const [isZooming, setIsZooming] = useState(false)
  const mainRef = useRef<HTMLDivElement>(null)

  const activeImage = images[activeIndex] ?? null

  const goTo = useCallback(
    (index: number) => {
      if (index === activeIndex) return
      setHasInteracted(true)
      setDirection(index > activeIndex ? 1 : -1)
      setActiveIndex(index)
    },
    [activeIndex],
  )

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!mainRef.current) return
    const rect = mainRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setZoomPosition({ x, y })
  }

  // Mobile swipe
  const touchStartX = useRef(0)
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }
  const handleTouchEnd = (e: React.TouchEvent) => {
    const diff = touchStartX.current - e.changedTouches[0].clientX
    if (Math.abs(diff) > 50) {
      if (diff > 0 && activeIndex < images.length - 1) goTo(activeIndex + 1)
      if (diff < 0 && activeIndex > 0) goTo(activeIndex - 1)
    }
  }

  if (images.length === 0) {
    return (
      <div className="aspect-square rounded-2xl bg-muted flex items-center justify-center">
        <span className="text-4xl font-bold text-muted-foreground/20">
          {productName.charAt(0).toUpperCase()}
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Main Image — crossfade + zoom + keyboard nav */}
      <div
        ref={mainRef}
        tabIndex={0}
        role="img"
        aria-label={`${productName} — ${activeIndex + 1} / ${images.length}`}
        className="relative aspect-square rounded-2xl overflow-hidden bg-muted cursor-crosshair focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 outline-none"
        onMouseEnter={() => setIsZooming(true)}
        onMouseLeave={() => setIsZooming(false)}
        onMouseMove={handleMouseMove}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' && activeIndex < images.length - 1) goTo(activeIndex + 1)
          if (e.key === 'ArrowLeft' && activeIndex > 0) goTo(activeIndex - 1)
        }}
      >
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          {activeImage && (
            <motion.div
              key={activeIndex}
              custom={direction}
              initial={hasInteracted ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className="absolute inset-0"
            >
              <Image
                src={activeImage.url}
                alt={
                  activeImage.altText ??
                  `${productName} ${activeIndex + 1}`
                }
                fill
                priority
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 600px"
                className="object-cover transition-[transform-origin] duration-100"
                style={
                  isZooming
                    ? {
                        transform: 'scale(2)',
                        transformOrigin: `${zoomPosition.x}% ${zoomPosition.y}%`,
                      }
                    : undefined
                }
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Hint indicators */}
        {!isZooming && images.length > 1 && (
          <div className="absolute bottom-3 right-3 rtl:right-auto rtl:left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/40 backdrop-blur-sm text-white text-[11px] font-medium pointer-events-none hidden sm:block">
            <span>← →</span>
          </div>
        )}
      </div>

      {/* Thumbnails (Desktop) */}
      {images.length > 1 && (
        <div className="hidden sm:flex gap-2 overflow-x-auto">
          {images.map((img, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={`${productName} ${i + 1}`}
              className={`relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                i === activeIndex
                  ? 'ring-2 ring-accent ring-offset-2'
                  : 'opacity-60 hover:opacity-100'
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
              onClick={() => goTo(i)}
              className={`h-2.5 rounded-full transition-all duration-300 ${
                i === activeIndex
                  ? 'w-7 bg-accent'
                  : 'w-2.5 bg-muted-foreground/50'
              }`}
              aria-label={`${i + 1} / ${images.length}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
