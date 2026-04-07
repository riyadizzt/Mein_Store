'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

const UTM_KEY = 'malak-utm'

// Maps utm_source to SalesChannel enum values
const SOURCE_TO_CHANNEL: Record<string, string> = {
  facebook: 'facebook',
  fb: 'facebook',
  instagram: 'instagram',
  ig: 'instagram',
  tiktok: 'tiktok',
  tt: 'tiktok',
  whatsapp: 'whatsapp',
  wa: 'whatsapp',
  google: 'google',
}

/** Captures UTM parameters on first visit and stores in sessionStorage */
export function UtmCapture() {
  const searchParams = useSearchParams()

  useEffect(() => {
    const source = searchParams.get('utm_source')
    if (!source) return

    // Only store on first visit — don't overwrite
    if (sessionStorage.getItem(UTM_KEY)) return

    sessionStorage.setItem(UTM_KEY, JSON.stringify({
      utm_source: source,
      utm_medium: searchParams.get('utm_medium') ?? '',
      utm_campaign: searchParams.get('utm_campaign') ?? '',
      captured_at: new Date().toISOString(),
    }))
  }, [searchParams])

  return null
}

/** Returns the SalesChannel derived from stored UTM params, or 'website' */
export function getChannelFromUtm(): string {
  try {
    const raw = sessionStorage.getItem(UTM_KEY)
    if (!raw) return 'website'
    const { utm_source } = JSON.parse(raw)
    return SOURCE_TO_CHANNEL[utm_source?.toLowerCase()] ?? 'website'
  } catch {
    return 'website'
  }
}
