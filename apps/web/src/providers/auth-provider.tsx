'use client'

import { useEffect, useRef, useState } from 'react'
import { useAuthStore } from '@/store/auth-store'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

/**
 * AuthProvider — restores BOTH sessions (admin + customer) independently.
 * Each session has its own cookie and token slot.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const setUser = useAuthStore((s) => s.setUser)
  const setAccessToken = useAuthStore((s) => s.setAccessToken)
  const setAdminUser = useAuthStore((s) => s.setAdminUser)
  const setAdminAccessToken = useAuthStore((s) => s.setAdminAccessToken)
  const initialized = useRef(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const restoreSession = async (tokenType: 'admin' | 'customer') => {
      try {
        const refreshRes = await fetch(`${API_URL}/api/v1/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tokenType }),
        })
        if (!refreshRes.ok) return

        const refreshData = await refreshRes.json()
        const accessToken = refreshData?.data?.accessToken
        if (!accessToken) return

        const meRes = await fetch(`${API_URL}/api/v1/auth/me`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          credentials: 'include',
        })
        if (!meRes.ok) return

        const meData = await meRes.json()
        const user = meData?.data ?? meData

        if (tokenType === 'admin' && ['admin', 'super_admin', 'warehouse_staff'].includes(user.role)) {
          setAdminAccessToken(accessToken)
          setAdminUser(user)
        } else if (tokenType === 'customer') {
          setAccessToken(accessToken)
          setUser(user)
        }
      } catch {
        // No session for this type — normal
      }
    }

    // Restore both sessions in parallel
    Promise.all([
      restoreSession('customer'),
      restoreSession('admin'),
    ]).finally(() => setReady(true))
  }, [setUser, setAccessToken, setAdminUser, setAdminAccessToken])

  if (!ready) return null

  return <>{children}</>
}
