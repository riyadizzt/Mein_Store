'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import { useLocale } from 'next-intl'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

// ── Copy ──
const COPY = {
  de: { eyebrow: 'NEUE KOLLEKTION', title: 'MALAK BEKLEIDUNG', subtitle: 'Mode, die bleibt. Qualität, die man spürt.', cta: 'Kollektion entdecken' },
  en: { eyebrow: 'NEW COLLECTION', title: 'MALAK BEKLEIDUNG', subtitle: 'Fashion that lasts. Quality you can feel.', cta: 'Explore Collection' },
  ar: { eyebrow: 'المجموعة الجديدة', title: 'MALAK BEKLEIDUNG', subtitle: 'أزياء تبقى. جودة تلمسها.', cta: 'استكشف المجموعة' },
}

// ── Particle system ──
interface Particle { x: number; y: number; size: number; speed: number; opacity: number; drift: number }

function createParticles(count: number): Particle[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * 100,
    y: 100 + Math.random() * 20,
    size: 1.5 + Math.random() * 2.5,
    speed: 0.15 + Math.random() * 0.25,
    opacity: 0.15 + Math.random() * 0.3,
    drift: (Math.random() - 0.5) * 0.3,
  }))
}

export function HeroPremium({ locale }: { locale: string }) {
  const currentLocale = useLocale() as 'de' | 'en' | 'ar'
  const copy = COPY[currentLocale] ?? COPY.de
  const isRTL = currentLocale === 'ar'

  const containerRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useRef({ x: 0.5, y: 0.5 })
  const scrollRef = useRef(0)
  const particlesRef = useRef<Particle[]>(createParticles(18))
  const rafRef = useRef<number>(0)

  // ── Animation phase ──
  const [phase, setPhase] = useState(0) // 0=hidden, 1=eyebrow, 2=title, 3=subtitle, 4=cta
  const [prefersReduced, setPrefersReduced] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setPrefersReduced(mq.matches)
    if (mq.matches) { setPhase(4); return }

    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 800),
      setTimeout(() => setPhase(3), 1800),
      setTimeout(() => setPhase(4), 2400),
    ]
    return () => timers.forEach(clearTimeout)
  }, [])

  // ── Mouse tracking (desktop) ──
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    mouseRef.current = {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    }
  }, [])

  // ── Scroll tracking ──
  useEffect(() => {
    const onScroll = () => { scrollRef.current = window.scrollY }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // ── Mouse listener ──
  useEffect(() => {
    const el = containerRef.current
    if (!el || prefersReduced) return
    el.addEventListener('mousemove', handleMouseMove)
    return () => el.removeEventListener('mousemove', handleMouseMove)
  }, [handleMouseMove, prefersReduced])

  // ── Canvas particle animation ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || prefersReduced) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.scale(dpr, dpr)
    }
    resize()
    window.addEventListener('resize', resize)

    const animate = () => {
      const { width, height } = canvas.getBoundingClientRect()
      ctx.clearRect(0, 0, width, height)

      for (const p of particlesRef.current) {
        p.y -= p.speed
        p.x += p.drift * 0.1
        if (p.y < -5) { p.y = 105; p.x = Math.random() * 100 }

        const px = (p.x / 100) * width
        const py = (p.y / 100) * height

        ctx.beginPath()
        ctx.arc(px, py, p.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(212, 168, 83, ${p.opacity})`
        ctx.fill()
      }

      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [prefersReduced])

  // ── Glow position as CSS custom properties ──
  const [glow, setGlow] = useState({ x: 50, y: 50 })
  useEffect(() => {
    if (prefersReduced) return
    let running = true
    const tick = () => {
      if (!running) return
      setGlow(prev => ({
        x: prev.x + (mouseRef.current.x * 100 - prev.x) * 0.05,
        y: prev.y + (mouseRef.current.y * 100 - prev.y) * 0.05,
      }))
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return () => { running = false }
  }, [prefersReduced])

  // ── Scroll-based opacity ──
  const [scrollOpacity, setScrollOpacity] = useState(1)
  useEffect(() => {
    if (prefersReduced) return
    let running = true
    const tick = () => {
      if (!running) return
      const h = containerRef.current?.offsetHeight ?? 600
      setScrollOpacity(Math.max(0, 1 - scrollRef.current / (h * 0.7)))
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return () => { running = false }
  }, [prefersReduced])

  return (
    <section
      ref={containerRef}
      className="relative h-[50vh] sm:h-[60vh] lg:h-[65vh] overflow-hidden select-none"
      style={{ background: '#1a1a2e' }}
    >
      {/* ── Animated mesh gradient background ── */}
      <div
        className="absolute inset-0 transition-none"
        style={{
          background: `
            radial-gradient(ellipse 60% 50% at ${glow.x}% ${glow.y}%, rgba(212,168,83,0.12) 0%, transparent 70%),
            radial-gradient(ellipse 80% 60% at 20% 80%, rgba(42,26,62,0.8) 0%, transparent 60%),
            radial-gradient(ellipse 70% 50% at 80% 20%, rgba(30,20,50,0.9) 0%, transparent 60%),
            #1a1a2e
          `,
        }}
      />

      {/* ── Slow-moving gradient overlay (CSS animation) ── */}
      {!prefersReduced && (
        <div className="absolute inset-0 opacity-30 hero-gradient-move" />
      )}

      {/* ── Gold particles (canvas) ── */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        aria-hidden="true"
      />

      {/* ── Subtle grid lines ── */}
      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: 'linear-gradient(rgba(212,168,83,1) 1px, transparent 1px), linear-gradient(90deg, rgba(212,168,83,1) 1px, transparent 1px)',
        backgroundSize: '80px 80px',
      }} />

      {/* ── Content ── */}
      <div
        className="relative z-10 h-full flex flex-col items-center justify-center px-6 text-center"
        style={{ opacity: scrollOpacity, transform: `translateY(${scrollRef.current * 0.15}px)` }}
      >
        {/* Eyebrow */}
        <p
          className={`text-[11px] sm:text-xs tracking-[0.35em] text-[#d4a853] mb-4 sm:mb-6 transition-all duration-700 ease-out ${
            phase >= 1 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
        >
          {copy.eyebrow}
        </p>

        {/* Title — typewriter */}
        <h1
          className={`font-display text-[32px] sm:text-[48px] md:text-[60px] lg:text-[72px] font-light text-white tracking-[0.15em] sm:tracking-[0.2em] leading-none mb-4 sm:mb-6 transition-all duration-700 ease-out ${
            phase >= 2 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
          }`}
        >
          {phase >= 2 ? (
            <span className="inline-block overflow-hidden">
              {copy.title.split('').map((char, i) => (
                <span
                  key={i}
                  className={prefersReduced ? '' : 'hero-letter'}
                  style={prefersReduced ? undefined : { animationDelay: `${i * 60}ms` }}
                >
                  {char === ' ' ? '\u00A0' : char}
                </span>
              ))}
            </span>
          ) : (
            <span className="invisible">{copy.title}</span>
          )}
        </h1>

        {/* Subtitle */}
        <p
          className={`text-sm sm:text-base md:text-lg text-white/50 font-light max-w-lg mx-auto mb-8 sm:mb-10 transition-all duration-700 ease-out ${
            phase >= 3 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
        >
          {copy.subtitle}
        </p>

        {/* CTA */}
        <div className={`transition-all duration-700 ease-out ${phase >= 4 ? 'opacity-100 scale-100' : 'opacity-0 scale-90'}`}>
          <Link
            href={`/${locale}/products`}
            className="group inline-flex items-center gap-3 px-8 py-3.5 border border-[#d4a853]/40 text-[#d4a853] text-sm tracking-[0.15em] uppercase hover:bg-[#d4a853] hover:text-[#1a1a2e] transition-all duration-500"
          >
            {copy.cta}
            <ArrowRight className={`h-4 w-4 transition-transform duration-300 group-hover:translate-x-1 ${isRTL ? 'rotate-180 group-hover:-translate-x-1' : ''}`} />
          </Link>
        </div>

        {/* Scroll hint */}
        <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 transition-all duration-700 ${phase >= 4 ? 'opacity-40' : 'opacity-0'}`}>
          <div className="w-5 h-8 rounded-full border border-white/20 flex items-start justify-center pt-1.5">
            <div className="w-1 h-2 rounded-full bg-white/40 animate-bounce" />
          </div>
        </div>
      </div>

      {/* ── CSS Animations ── */}
      <style>{`
        @keyframes hero-gradient-shift {
          0%, 100% { transform: translate(0, 0) scale(1); }
          25% { transform: translate(3%, -2%) scale(1.02); }
          50% { transform: translate(-2%, 3%) scale(0.98); }
          75% { transform: translate(1%, -1%) scale(1.01); }
        }
        .hero-gradient-move {
          background: radial-gradient(ellipse 50% 40% at 30% 40%, rgba(212,168,83,0.15), transparent 70%),
                      radial-gradient(ellipse 40% 50% at 70% 60%, rgba(100,60,160,0.1), transparent 60%);
          animation: hero-gradient-shift 18s ease-in-out infinite;
          will-change: transform;
        }
        @keyframes hero-letter-in {
          from { opacity: 0; transform: translateY(8px); filter: blur(4px); }
          to { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
        .hero-letter {
          display: inline-block;
          opacity: 0;
          animation: hero-letter-in 0.4s ease-out forwards;
        }
      `}</style>
    </section>
  )
}
