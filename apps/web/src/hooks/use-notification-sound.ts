'use client'

import { useRef, useCallback } from 'react'

/**
 * Plays a pleasant notification "ding" sound using Web Audio API.
 * No audio files needed — generated programmatically.
 */
export function useNotificationSound() {
  const ctxRef = useRef<AudioContext | null>(null)
  const canPlayRef = useRef(false)

  // Enable sound after first user interaction (browser autoplay policy)
  const enableSound = useCallback(() => {
    canPlayRef.current = true
    if (!ctxRef.current) {
      ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
  }, [])

  const playDing = useCallback(() => {
    if (!canPlayRef.current || !ctxRef.current) return

    const ctx = ctxRef.current
    if (ctx.state === 'suspended') ctx.resume()

    const now = ctx.currentTime

    // Two-tone pleasant ding
    const osc1 = ctx.createOscillator()
    const osc2 = ctx.createOscillator()
    const gain = ctx.createGain()

    osc1.type = 'sine'
    osc1.frequency.setValueAtTime(880, now) // A5
    osc2.type = 'sine'
    osc2.frequency.setValueAtTime(1320, now) // E6

    gain.gain.setValueAtTime(0.15, now)
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6)

    osc1.connect(gain)
    osc2.connect(gain)
    gain.connect(ctx.destination)

    osc1.start(now)
    osc2.start(now + 0.1)
    osc1.stop(now + 0.5)
    osc2.stop(now + 0.6)
  }, [])

  return { playDing, enableSound }
}
