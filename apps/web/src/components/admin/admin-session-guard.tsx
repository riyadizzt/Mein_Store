'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useAuthStore } from '@/store/auth-store'

const INACTIVITY_TIMEOUT = 30 * 60 * 1000 // 30 minutes
const MAX_SESSION_DURATION = 8 * 60 * 60 * 1000 // 8 hours absolute max

/**
 * Admin Session Guard — monitors inactivity and max session duration.
 * - After 30 min inactivity → auto-logout with message
 * - After 8 hours total → auto-logout regardless of activity
 * - Only affects admin sessions, NOT customer sessions
 */
export function AdminSessionGuard() {
  const isAdminAuthenticated = useAuthStore((s) => s.isAdminAuthenticated)
  const adminLogout = useAuthStore((s) => s.adminLogout)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const sessionStartRef = useRef<number>(Date.now())

  const handleLogout = useCallback((reason: string) => {
    adminLogout()
    // Store reason for login page to show
    try { sessionStorage.setItem('malak-admin-logout-reason', reason) } catch {}
    window.location.href = '/de/admin/login'
  }, [adminLogout])

  const resetInactivityTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      handleLogout('inactivity')
    }, INACTIVITY_TIMEOUT)
  }, [handleLogout])

  useEffect(() => {
    if (!isAdminAuthenticated) return

    // Set session start time
    sessionStartRef.current = Date.now()

    // Start inactivity timer
    resetInactivityTimer()

    // Listen for user activity
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click']
    const onActivity = () => {
      // Check max session duration
      if (Date.now() - sessionStartRef.current > MAX_SESSION_DURATION) {
        handleLogout('max_duration')
        return
      }
      resetInactivityTimer()
    }

    events.forEach(e => window.addEventListener(e, onActivity, { passive: true }))

    // Max session timer (8 hours absolute)
    const maxTimer = setTimeout(() => {
      handleLogout('max_duration')
    }, MAX_SESSION_DURATION)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      clearTimeout(maxTimer)
      events.forEach(e => window.removeEventListener(e, onActivity))
    }
  }, [isAdminAuthenticated, resetInactivityTimer, handleLogout])

  return null // Invisible component
}
