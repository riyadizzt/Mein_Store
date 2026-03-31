'use client'

import { useCallback, useRef } from 'react'

type FeedbackType = 'new' | 'duplicate' | 'error'

// Generate beep tones programmatically via AudioContext — no audio files needed
export function useScannerFeedback() {
  const ctxRef = useRef<AudioContext | null>(null)

  const getCtx = useCallback(() => {
    if (!ctxRef.current) ctxRef.current = new AudioContext()
    return ctxRef.current
  }, [])

  const playTone = useCallback((freq: number, duration: number, type: OscillatorType = 'sine') => {
    try {
      const ctx = getCtx()
      if (ctx.state === 'suspended') ctx.resume()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = type
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + duration)
    } catch {
      // AudioContext not available
    }
  }, [getCtx])

  const feedback = useCallback((type: FeedbackType) => {
    // Haptic vibration
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      if (type === 'new') navigator.vibrate(80)
      else if (type === 'duplicate') navigator.vibrate([40, 30, 40])
      else navigator.vibrate([100, 50, 100])
    }

    // Sound
    if (type === 'new') {
      playTone(880, 0.15, 'sine')     // High positive beep
      setTimeout(() => playTone(1100, 0.1, 'sine'), 100)  // Double-beep for new
    } else if (type === 'duplicate') {
      playTone(660, 0.12, 'sine')     // Softer single beep
    } else {
      playTone(220, 0.3, 'square')    // Low buzz for error
    }
  }, [playTone])

  return { feedback }
}
