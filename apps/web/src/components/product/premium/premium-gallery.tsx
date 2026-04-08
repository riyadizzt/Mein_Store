'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Image from 'next/image'
import { AnimatePresence, motion } from 'motion/react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'

interface GalleryImage {
  url: string
  altText?: string
}

interface PremiumGalleryProps {
  images: GalleryImage[]
  productName: string
  isRTL?: boolean
}

export function PremiumGallery({ images, productName, isRTL }: PremiumGalleryProps) {
  const [active, setActive] = useState(0)
  const [lightbox, setLightbox] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const [zoomOrigin, setZoomOrigin] = useState('50% 50%')
  const [hoverZoom, setHoverZoom] = useState({ x: 50, y: 50, active: false })
  const mouseDownPos = useRef({ x: 0, y: 0 })
  const touchStartX = useRef(0)

  const total = images.length
  const img = images[active]

  const go = useCallback((i: number) => {
    setActive(i)
    setZoomed(false)
    setZoomOrigin('50% 50%')
  }, [])

  const prev = useCallback(() => { if (active > 0) go(active - 1) }, [active, go])
  const next = useCallback(() => { if (active < total - 1) go(active + 1) }, [active, total, go])

  // Keyboard + body lock for lightbox
  useEffect(() => {
    if (!lightbox) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setLightbox(false); setZoomed(false) }
      if (e.key === 'ArrowLeft') { isRTL ? next() : prev() }
      if (e.key === 'ArrowRight') { isRTL ? prev() : next() }
    }
    document.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', handler); document.body.style.overflow = '' }
  }, [lightbox, prev, next, isRTL])

  // Main image hover zoom
  const handleMainHover = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setHoverZoom({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
      active: true,
    })
  }

  // Lightbox click → toggle zoom
  const handleLightboxClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const dx = Math.abs(e.clientX - mouseDownPos.current.x)
    const dy = Math.abs(e.clientY - mouseDownPos.current.y)
    if (dx > 5 || dy > 5) return // was a drag/swipe

    if (zoomed) {
      setZoomed(false)
      setZoomOrigin('50% 50%')
    } else {
      const rect = e.currentTarget.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * 100
      const y = ((e.clientY - rect.top) / rect.height) * 100
      setZoomOrigin(`${x}% ${y}%`)
      setZoomed(true)
    }
  }

  // When zoomed, pan follows mouse
  const handleLightboxMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!zoomed) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setZoomOrigin(`${x}% ${y}%`)
  }

  // Mobile swipe
  const handleTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX }
  const handleTouchEnd = (e: React.TouchEvent) => {
    const diff = touchStartX.current - e.changedTouches[0].clientX
    const direction = isRTL ? -1 : 1
    if (Math.abs(diff) > 60) {
      if (diff * direction > 0) next()
      else prev()
    }
  }

  if (images.length === 0) {
    return (
      <div className="aspect-[4/5] bg-[#f5f5f5] flex items-center justify-center">
        <span className="text-7xl font-display font-light text-[#e5e5e5] select-none">
          {productName.charAt(0).toUpperCase()}
        </span>
      </div>
    )
  }

  return (
    <>
      {/* ─── Main Image ─── */}
      <div className="space-y-3">
        <div
          className="relative aspect-[4/5] bg-[#f5f5f5] overflow-hidden cursor-zoom-in"
          onClick={() => setLightbox(true)}
          onMouseMove={handleMainHover}
          onMouseLeave={() => setHoverZoom(p => ({ ...p, active: false }))}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          role="button"
          tabIndex={0}
          aria-label={`${productName} — ${active + 1} / ${total}`}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') { isRTL ? next() : prev() }
            if (e.key === 'ArrowRight') { isRTL ? prev() : next() }
            if (e.key === 'Enter') setLightbox(true)
          }}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={active}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
              className="absolute inset-0"
            >
              <Image
                src={img!.url}
                alt={img!.altText ?? `${productName} ${active + 1}`}
                fill
                priority={active === 0}
                sizes="(max-width: 1024px) 100vw, 60vw"
                className="object-cover will-change-transform"
                style={{
                  transition: 'transform 0.4s cubic-bezier(0.25, 0.1, 0.25, 1)',
                  ...(hoverZoom.active ? {
                    transform: 'scale(1.06)',
                    transformOrigin: `${hoverZoom.x}% ${hoverZoom.y}%`,
                  } : {}),
                }}
              />
            </motion.div>
          </AnimatePresence>

          {/* Image counter */}
          {total > 1 && (
            <div className="absolute bottom-4 inset-x-0 flex justify-center pointer-events-none">
              <span className="text-[11px] tracking-[0.2em] text-white/60 bg-black/15 backdrop-blur-sm px-3 py-1">
                {active + 1} / {total}
              </span>
            </div>
          )}
        </div>

        {/* ─── Thumbnails ─── */}
        {total > 1 && (
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
            {images.map((im, i) => (
              <button
                key={i}
                onClick={() => go(i)}
                aria-label={`${productName} ${i + 1}`}
                className={`relative flex-shrink-0 w-[68px] h-[85px] overflow-hidden transition-opacity duration-200 ${
                  i === active ? 'opacity-100 ring-1 ring-[#0f1419]' : 'opacity-40 hover:opacity-70'
                }`}
              >
                <Image src={im.url} alt="" fill sizes="68px" className="object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        )}

        {/* ─── Mobile Dots ─── */}
        {total > 1 && (
          <div className="flex lg:hidden justify-center gap-1.5 pt-1">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => go(i)}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === active ? 'w-6 bg-[#0f1419]' : 'w-1.5 bg-[#0f1419]/20'
                }`}
                aria-label={`${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* ─── Fullscreen Lightbox ─── */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[100] bg-white"
          >
            {/* Close */}
            <button
              onClick={() => { setLightbox(false); setZoomed(false) }}
              className="absolute top-5 right-5 rtl:right-auto rtl:left-5 z-10 h-11 w-11 flex items-center justify-center text-[#0f1419]/40 hover:text-[#0f1419] transition-colors"
              aria-label="Close"
            >
              <X className="h-5 w-5" strokeWidth={1.5} />
            </button>

            {/* Counter */}
            {total > 1 && (
              <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10 text-[11px] tracking-[0.25em] text-[#0f1419]/30 select-none">
                {active + 1} / {total}
              </div>
            )}

            {/* Nav arrows */}
            {total > 1 && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); isRTL ? next() : prev() }}
                  disabled={active === 0}
                  className="absolute left-4 sm:left-8 top-1/2 -translate-y-1/2 z-10 h-11 w-11 flex items-center justify-center text-[#0f1419]/25 hover:text-[#0f1419]/60 transition-colors disabled:opacity-0"
                  aria-label="Previous"
                >
                  <ChevronLeft className="h-6 w-6" strokeWidth={1.5} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); isRTL ? prev() : next() }}
                  disabled={active === total - 1}
                  className="absolute right-4 sm:right-8 top-1/2 -translate-y-1/2 z-10 h-11 w-11 flex items-center justify-center text-[#0f1419]/25 hover:text-[#0f1419]/60 transition-colors disabled:opacity-0"
                  aria-label="Next"
                >
                  <ChevronRight className="h-6 w-6" strokeWidth={1.5} />
                </button>
              </>
            )}

            {/* Lightbox Image */}
            <div
              className="flex items-center justify-center w-full h-full p-8 sm:p-16"
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              <div
                className={`relative max-w-full max-h-full overflow-hidden ${zoomed ? 'cursor-zoom-out' : 'cursor-zoom-in'}`}
                onMouseDown={(e) => { mouseDownPos.current = { x: e.clientX, y: e.clientY } }}
                onClick={handleLightboxClick}
                onMouseMove={handleLightboxMove}
              >
                <Image
                  key={active}
                  src={images[active]!.url}
                  alt={images[active]!.altText ?? `${productName} ${active + 1}`}
                  width={1200}
                  height={1500}
                  className="max-h-[85vh] w-auto object-contain select-none will-change-transform"
                  style={{
                    transformOrigin: zoomOrigin,
                    transform: zoomed ? 'scale(2.2)' : 'scale(1)',
                    transition: 'transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)',
                  }}
                  draggable={false}
                  priority
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
