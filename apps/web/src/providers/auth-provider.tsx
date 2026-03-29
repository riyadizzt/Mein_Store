'use client'

import { useEffect, useRef, useState } from 'react'
import { useAuthStore } from '@/store/auth-store'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

/**
 * AuthProvider — runs on app mount to restore session from HttpOnly cookie.
 * Calls POST /auth/refresh → if cookie exists, gets new accessToken → user is logged in.
 * If no cookie or expired → user stays logged out (no error shown).
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const setUser = useAuthStore((s) => s.setUser)
  const setAccessToken = useAuthStore((s) => s.setAccessToken)
  const initialized = useRef(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const restore = async () => {
      try {
        const refreshRes = await fetch(`${API_URL}/api/v1/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        if (!refreshRes.ok) { setReady(true); return }

        const refreshData = await refreshRes.json()
        const accessToken = refreshData?.data?.accessToken
        if (!accessToken) { setReady(true); return }

        setAccessToken(accessToken)

        const meRes = await fetch(`${API_URL}/api/v1/auth/me`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          credentials: 'include',
        })
        if (meRes.ok) {
          const meData = await meRes.json()
          setUser(meData?.data ?? meData)
        }
      } catch {
        // No session — normal for first-time visitors
      }
      setReady(true)
    }

    restore()
  }, [setUser, setAccessToken])

  // Prevent flash of unauthenticated content
  if (!ready) return null

  return <>{children}</>
}
