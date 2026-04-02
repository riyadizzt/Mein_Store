'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth-store'

interface Notification {
  id: string
  type: string
  title: string
  body: string
  entityType?: string
  entityId?: string
  channel: string
  isRead: boolean
  data?: any
  createdAt: string
}

export function useNotificationStream() {
  const qc = useQueryClient()
  const token = useAuthStore((s) => s.adminAccessToken)
  const [lastNotification, setLastNotification] = useState<Notification | null>(null)
  const [connected, setConnected] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeout = useRef<NodeJS.Timeout>()

  const connect = useCallback(() => {
    if (!token) return

    const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
    // SSE doesn't support custom headers, so we pass token as query param
    const url = `${API}/api/v1/admin/notifications/stream?token=${encodeURIComponent(token)}`

    try {
      const es = new EventSource(url)
      eventSourceRef.current = es

      es.onopen = () => {
        setConnected(true)
      }

      es.addEventListener('notification', (event) => {
        try {
          const notification = JSON.parse(event.data)
          setLastNotification(notification)
          // Invalidate React Query cache to refresh notification list + badge
          qc.invalidateQueries({ queryKey: ['admin-notifications'] })
          qc.invalidateQueries({ queryKey: ['admin-notifications-unread'] })
        } catch { /* ignore parse errors */ }
      })

      es.addEventListener('heartbeat', () => {
        // Keep-alive, nothing to do
      })

      es.onerror = () => {
        setConnected(false)
        es.close()
        eventSourceRef.current = null
        // Auto-reconnect after 5 seconds
        reconnectTimeout.current = setTimeout(connect, 5000)
      }
    } catch {
      // SSE not supported or connection failed — fall back to polling
      setConnected(false)
    }
  }, [token, qc])

  useEffect(() => {
    connect()
    return () => {
      eventSourceRef.current?.close()
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current)
    }
  }, [connect])

  return { lastNotification, connected }
}
