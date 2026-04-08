'use client'

import { useEffect } from 'react'

export function ConsoleEasterEgg() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    console.log(
      '%c MALAK ',
      'background: linear-gradient(135deg, #c8a97e, #a07850); color: white; font-size: 24px; font-weight: bold; padding: 8px 16px; border-radius: 8px; letter-spacing: 0.2em;',
    )
    console.log(
      '%cPremium Fashion — Made in Frankfurt 🇩🇪',
      'color: #c8a97e; font-size: 12px; font-weight: 500;',
    )
  }, [])

  return null
}
