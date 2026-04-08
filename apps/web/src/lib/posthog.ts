import posthog from 'posthog-js'
import { useConsentStore } from '@/store/consent-store'

let initialized = false

/**
 * Initialize PostHog — only when analytics consent is given.
 * Uses EU servers (eu.posthog.com) for DSGVO compliance.
 */
export function initPostHog() {
  if (initialized) return
  if (typeof window === 'undefined') return

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com'

  if (!key) return

  const consent = useConsentStore.getState()
  if (!consent.analytics) return

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
