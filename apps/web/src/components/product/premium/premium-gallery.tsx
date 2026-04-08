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
  const [direction, setDirection] = useState(0) // -1 = prev, 1 = next
  const [lightbox, setLightbox] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const [zoomOrigin, setZoomOrigin] = useState('50% 50%')
  const [hoverZoom, setHoverZoom] = useState({ x: 50, y: 50, active: false })

  // Drag/swipe state
  const dragStartX = useRef(0)
  const dragStartY = useRef(0)
  const isDragging = useRef(false)
  const hasDragged = useRef(false)

  const total = images.length
  const img = images[active]

  const go = useCallback((i: number) => {
    if (i === active || i < 0 || i >= total) return
    setDirection(i > active ? 1 : -1)
    setActive(i)
    setZoomed(false)
    setZoomOrigin('50% 50%')
  }, [active, total])

  const prev = useCallback(() => { if (active > 0) go(active - 1) }, [active, go])
  const next = useCallback(() => { if (active < total - 1) go(active + 1) }, [active, total, go])

  // ── Keyboard nav (always active when focused, not just lightbox) ──
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

  // ── Desktop mouse drag on main image ──
  const handleMouseDown = (e: React.MouseEvent) => {
    dragStartX.current = e.clientX
    dragStartY.current = e.clientY
    isDragging.current = true
    hasDragged.current = false
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) {
      // Hover zoom
      const rect = e.currentTarget.getBoundingClientRect()
      setHoverZoom({
        x: ((e.clientX - rect.left) / rect.width) * 100,
        y: ((e.clientY - rect.top) / rect.height) * 100,
        active: true,
      })
      return
    }
    const dx = e.clientX - dragStartX.current
    if (Math.abs(dx) > 10) hasDragged.current = true
  }

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isDragging.current) return
    isDragging.current = false
    const dx = e.clientX - dragStartX.current
    const dy = Math.abs(e.clientY - dragStartY.current)

    if (Math.abs(dx) > 50 && dy < 100) {
      const dir = isRTL ? -1 : 1
      if (dx * dir < 0) next()
      else prev()
    } else if (!hasDragged.current) {
      // Was a click, not drag → open lightbox
      setLightbox(true)
    }
    hasDragged.current = false
  }

  // ── Touch swipe ──
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const touchMoved = useRef(false)

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    touchMoved.current = false
  }
  const handleTouchMove = (e: React.TouchEvent) => {
    const dx = Math.abs(e.touches[0].clientX - touchStartX.current)
    if (dx > 10) touchMoved.current = true
  }
  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = touchStartX.current - e.changedTouches[0].clientX
    const dy = Math.abs(touchStartY.current - e.changedTouches[0].clientY)
    const dir = isRTL ? -1 : 1
    if (Math.abs(dx) > 50 && dy < 100) {
      if (dx * dir > 0) next()
      else prev()
    }
  }

  // ── Lightbox handlers ──
  const lbMouseDown = useRef({ x: 0, y: 0 })
  const handleLightboxClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const dx = Math.abs(e.clientX - lbMouseDown.current.x)
    const dy = Math.abs(e.clientY - lbMouseDown.current.y)
    if (dx > 5 || dy > 5) return
    if (zoomed) { setZoomed(false); setZoomOrigin('50% 50%') }
    else {
      const rect = e.currentTarget.getBoundingClientRect()
      setZoomOrigin(`${((e.clientX - rect.left) / rect.width) * 100}% ${((e.clientY - rect.top) / rect.height) * 100}%`)
      setZoomed(true)
    }
  }
  const handleLightboxMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!zoomed) return
    const rect = e.currentTarget.getBoundingClientRect()
    setZoomOrigin(`${((e.clientX - rect.left) / rect.width) * 100}% ${((e.clientY - rect.top) / rect.height) * 100}%`)
  }

  // ── Slide animation variants ──
  const slideVariants = {
    enter: (dir: number) => ({ x: dir > 0 ? '30%' : '-30%', opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? '-30%' : '30%', opacity: 0 }),
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
          className="relative aspect-[4/5] max-h-[620px] bg-[#f5f5f5] overflow-hidden select-none group"
          style={{ cursor: isDragging.current ? 'grabbing' : 'grab', touchAction: 'pan-y' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={(e) => {
            setHoverZoom(p => ({ ...p, active: false }))
            if (isDragging.current) handleMouseUp(e)
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          tabIndex={0}
          aria-label={`${productName} — ${active + 1} / ${total}`}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') { isRTL ? next() : prev() }
            if (e.key === 'ArrowRight') { isRTL ? prev() : next() }
            if (e.key === 'Enter') setLightbox(true)
          }}
        >
          <AnimatePresence mode="popLayout" initial={false} custom={direction}>
            <motion.div
              key={active}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
              className="absolute inset-0"
            >
              <Image
                src={img!.url}
                alt={img!.altText ?? `${productName} ${active + 1}`}
                fill
                priority={active === 0}
                sizes="(max-width: 1024px) 100vw, 60vw"
                className="object-cover will-change-transform pointer-events-none"
                style={{
                  transition: 'transform 0.4s cubic-bezier(0.25, 0.1, 0.25, 1)',
                  ...(hoverZoom.active && !isDragging.current ? {
                    transform: 'scale(1.06)',
                    transformOrigin: `${hoverZoom.x}% ${hoverZoom.y}%`,
                  } : {}),
                }}
                draggable={false}
              />
            </motion.div>
          </AnimatePresence>

          {/* ← → Arrow Buttons (desktop) */}
          {total > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); isRTL ? next() : prev() }}
                className={`absolute left-3 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full bg-white/80 backdrop-blur-sm flex items-center justify-center text-[#0f1419]/50 hover:text-[#0f1419] hover:bg-white transition-all shadow-sm ${
                  active === 0 ? 'opacity-0 pointer-events-none' : 'opacity-0 group-hover:opacity-100'
                }`}
                aria-label="Previous"
              >
                <ChevronLeft className="h-5 w-5" strokeWidth={1.5} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); isRTL ? prev() : next() }}
                className={`absolute right-3 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full bg-white/80 backdrop-blur-sm flex items-center justify-center text-[#0f1419]/50 hover:text-[#0f1419] hover:bg-white transition-all shadow-sm ${
                  active === total - 1 ? 'opacity-0 pointer-events-none' : 'opacity-0 group-hover:opacity-100'
                }`}
                aria-label="Next"
              >
                <ChevronRight className="h-5 w-5" strokeWidth={1.5} />
              </button>
            </>
          )}

          {/* Image counter */}
          {total > 1 && (
            <div className="absolute bottom-4 inset-x-0 flex justify-center pointer-events-none">
              <span className="text-[11px] tracking-[0.2em] text-white/60 bg-black/15 backdrop-blur-sm px-3 py-1">
                {active + 1} / {total}
              </span>
            </div>
          )}
        </div>

        {/* ─── Thumbnails (desktop) ─── */}
        {total > 1 && (
          <div className="hidden lg:flex gap-2.5 overflow-x-auto scrollbar-hide pb-1 mt-3">
            {images.map((im, i) => (
              <button
                key={i}
                onClick={() => go(i)}
                aria-label={`${productName} ${i + 1}`}
                className={`relative flex-shrink-0 w-20 h-[100px] overflow-hidden transition-all duration-200 ${
                  i === active ? 'opacity-100 ring-2 ring-[#d4a853] ring-offset-1' : 'opacity-40 hover:opacity-70'
                }`}
              >
                <Image src={im.url} alt="" fill sizes="80px" className="object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        )}

        {/* ─── Dot indicators (mobile) ─── */}
        {total > 1 && (
          <div className="flex lg:hidden justify-center gap-2 pt-2">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => go(i)}
                className={`rounded-full transition-all duration-300 ${
                  i === active
                    ? 'w-2.5 h-2.5 bg-[#0f1419]'
                    : 'w-2 h-2 bg-[#0f1419]/20'
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
              <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10 text-sm tracking-[0.15em] text-[#0f1419]/40 select-none">
                {active + 1} / {total}
              </div>
            )}

            {/* Nav arrows */}
            {total > 1 && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); isRTL ? next() : prev() }}
                  disabled={active === 0}
                  className="absolute left-4 sm:left-8 top-1/2 -translate-y-1/2 z-10 h-12 w-12 rounded-full bg-[#f5f5f5] flex items-center justify-center text-[#0f1419]/40 hover:text-[#0f1419] hover:bg-[#e8e8e8] transition-all disabled:opacity-0"
                  aria-label="Previous"
                >
                  <ChevronLeft className="h-6 w-6" strokeWidth={1.5} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); isRTL ? prev() : next() }}
                  disabled={active === total - 1}
                  className="absolute right-4 sm:right-8 top-1/2 -translate-y-1/2 z-10 h-12 w-12 rounded-full bg-[#f5f5f5] flex items-center justify-center text-[#0f1419]/40 hover:text-[#0f1419] hover:bg-[#e8e8e8] transition-all disabled:opacity-0"
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
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              <div
                className={`relative max-w-full max-h-full overflow-hidden ${zoomed ? 'cursor-zoom-out' : 'cursor-zoom-in'}`}
                onMouseDown={(e) => { lbMouseDown.current = { x: e.clientX, y: e.clientY } }}
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

            {/* Lightbox dots */}
            {total > 1 && (
              <div className="absolute bottom-6 inset-x-0 flex justify-center gap-2 z-10">
                {images.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => go(i)}
                    className={`rounded-full transition-all duration-300 ${
                      i === active ? 'w-2.5 h-2.5 bg-[#0f1419]' : 'w-2 h-2 bg-[#0f1419]/20 hover:bg-[#0f1419]/40'
                    }`}
                    aria-label={`${i + 1}`}
                  />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
