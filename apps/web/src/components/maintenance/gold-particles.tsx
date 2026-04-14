'use client'

import { useEffect, useRef } from 'react'

/**
 * Elegant drifting gold dust for the maintenance page.
 *
 * - Canvas-based, requestAnimationFrame, no deps, no video.
 * - Particle count scales with viewport (~20 mobile, ~60 desktop, hard cap).
 * - Radial gold glow per particle (#d4a853) with gentle twinkle + upward drift.
 * - Respects prefers-reduced-motion: renders nothing, falls through to static gradient.
 * - Cleans up on unmount (raf cancelled, resize listener removed, tab-visibility
 *   pause so background tabs don't burn cycles).
 */
export function GoldParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (reduced.matches) return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    let width = 0
    let height = 0
    let dpr = 1
    let particles: Array<{
      x: number
      y: number
      r: number
      vy: number
      vx: number
      a: number
      phase: number
    }> = []

    const seedParticles = () => {
      const area = width * height
      // ~1 particle per 22k px² → desktop (1920×1080) ≈ 94 → capped at 60
      const count = Math.min(60, Math.max(20, Math.floor(area / 22000)))
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 1.6 + 0.4,
        vy: -(Math.random() * 0.18 + 0.05),
        vx: (Math.random() - 0.5) * 0.06,
        a: Math.random() * 0.5 + 0.25,
        phase: Math.random() * Math.PI * 2,
      }))
    }

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = width + 'px'
      canvas.style.height = height + 'px'
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(dpr, dpr)
      seedParticles()
    }
    resize()

    let raf = 0
    let t = 0
    let running = true

    const tick = () => {
      if (!running) return
      t += 0.016
      ctx.clearRect(0, 0, width, height)

      for (const p of particles) {
        p.y += p.vy
        p.x += p.vx + Math.sin(t + p.phase) * 0.12

        if (p.y < -12) {
          p.y = height + 12
          p.x = Math.random() * width
        }
        if (p.x < -12) p.x = width + 12
        if (p.x > width + 12) p.x = -12

        // Twinkle: softer low, gentle peak
        const twinkle = 0.55 + 0.45 * Math.sin(t * 1.3 + p.phase)
        ctx.globalAlpha = Math.min(1, p.a * (0.35 + twinkle * 0.65))

        const glowR = p.r * 4.5
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR)
        grad.addColorStop(0, '#d4a853')
        grad.addColorStop(0.35, 'rgba(212, 168, 83, 0.55)')
        grad.addColorStop(1, 'rgba(212, 168, 83, 0)')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.globalAlpha = 1
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const onVisibility = () => {
      if (document.hidden) {
        running = false
        cancelAnimationFrame(raf)
      } else if (!running) {
        running = true
        raf = requestAnimationFrame(tick)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('resize', resize)

    return () => {
      running = false
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 w-full h-full pointer-events-none z-[1]"
    />
  )
}
