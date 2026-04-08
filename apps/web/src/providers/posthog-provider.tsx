'use client'

import { useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useConsentStore, hydrateConsent } from '@/store/consent-store'
import { initPostHog, shutdownPostHog, posthog } from '@/lib/posthog'

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const analyticsConsent = useConsentStore((s) => s.analytics)
  const decided = useConsentStore((s) => s.decided)
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [ready, setReady] = useState(false)

  // Hydrate consent from localStorage on client mount
  useEffect(() => {
    hydrateConsent()
  }, [])

  // Initialize or shutdown based on consent
  useEffect(() => {
    if (!decided) return

    if (analyticsConsent) {
      initPostHog().then(() => setReady(true)).catch(() => {})
    } else {
      shutdownPostHog()
      setReady(false)
    }
  }, [analyticsConsent, decided])

  // Track pageviews on route change
  useEffect(() => {
    if (!ready || !analyticsConsent) return
    try {
      const url = `${pathname}${searchParams.toString() ? '?' + searchParams.toString() : ''}`
      posthog.capture('$pageview', { $current_url: url })
    } catch { /* PostHog not ready yet */ }
  }, [pathname, searchParams, analyticsConsent, ready])

  return <>{children}</>
}
