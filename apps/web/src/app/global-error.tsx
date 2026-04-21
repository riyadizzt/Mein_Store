'use client'

/**
 * Root error boundary for the App Router.
 *
 * Sentry recommends this file so React rendering errors that bubble up
 * past every other error boundary still get captured. Without it the
 * root-layout crash path is invisible to telemetry.
 *
 * This runs OUTSIDE [locale], so we can't use next-intl. Short, static
 * message in the three project languages is enough — the user's browser
 * tab is broken anyway at this point.
 */

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#0f1419', color: '#f2f2f5', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div style={{ maxWidth: 480, textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.75rem', color: '#d4a853' }}>
            Ein Fehler ist aufgetreten
          </h1>
          <p style={{ fontSize: '0.875rem', lineHeight: 1.6, opacity: 0.7, marginBottom: '1.5rem' }}>
            Something went wrong · حدث خطأ ما
            <br />
            Bitte lade die Seite neu. Das Team wurde automatisch benachrichtigt.
          </p>
          <button
            onClick={() => reset()}
            style={{
              padding: '0.75rem 1.5rem',
              background: '#d4a853',
              color: '#0f1419',
              border: 'none',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Erneut versuchen
          </button>
        </div>
      </body>
    </html>
  )
}
