'use client'

import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useConsentStore } from '@/store/consent-store'
import { initPostHog, shutdownPostHog, posthog } from '@/lib/posthog'

/**
 * PostHog Provider — consent-gated.
 * Only initializes PostHog when analytics consent is granted.
 * Tracks pageviews on route changes.
 * Shuts down if consent is revoked.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const analyticsConsent = useConsentStore((s) => s.analytics)
  const decided = useConsentStore((s) => s.decided)
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Initialize or shutdown based on consent
  useEffect(() => {
    if (!decided) return

    if (analyticsConsent) {
      initPostHog()
    } else {
      shutdownPostHog()
    }
  }, [analyticsConsent, decided])

  // Track pageviews on route change
  useEffect(() => {
    if (!analyticsConsent) return
    const url = `${pathname}${searchParams.toString() ? '?' + searchParams.toString() : ''}`
    posthog.capture('$pageview', { $current_url: url })
  }, [pathname, searchParams, analyticsConsent])

  return <>{children}</>
}
