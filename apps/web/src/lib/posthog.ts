import { API_BASE_URL } from '@/lib/env'
import posthog from 'posthog-js'
import { useConsentStore } from '@/store/consent-store'

let initialized = false

/**
 * Initialize PostHog — only when analytics consent is given.
 * Reads API key from Admin Settings (via API) or .env fallback.
 * Uses EU servers (eu.posthog.com) for DSGVO compliance.
 */
export async function initPostHog() {
  if (initialized) return
  if (typeof window === 'undefined') return

  const consent = useConsentStore.getState()
  if (!consent.analytics) return

  // Try to get key from Admin Settings (API), fallback to .env
  let key = process.env.NEXT_PUBLIC_POSTHOG_KEY || ''
  let host = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com'

  if (!key) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/settings/public`)
      if (res.ok) {
        const data = await res.json()
        key = data?.posthog_key ?? ''
        host = data?.posthog_host ?? host
        const enabled = data?.posthog_enabled
        if (enabled === 'false' || enabled === false) return
      }
    } catch { /* ignore */ }
  }

  if (!key) return

  posthog.init(key, {
    api_host: host,
    person_profiles: 'identified_only',
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '[data-mask]',
    },
    persistence: 'localStorage+cookie',
    loaded: () => { initialized = true },
  })

  initialized = true
}

/**
 * Shut down PostHog if consent is revoked.
 */
export function shutdownPostHog() {
  if (!initialized) return
  posthog.opt_out_capturing()
  initialized = false
}

/**
 * Track a custom event (only if consent given).
 */
export function trackEvent(event: string, properties?: Record<string, any>) {
  if (!initialized || !useConsentStore.getState().analytics) return
  posthog.capture(event, properties)
}

/**
 * Identify a user (after login).
 */
export function identifyUser(userId: string, properties?: Record<string, any>) {
  if (!initialized || !useConsentStore.getState().analytics) return
  posthog.identify(userId, properties)
}

/**
 * Reset identity (on logout).
 */
export function resetUser() {
  if (!initialized) return
  posthog.reset()
}

export { posthog }
