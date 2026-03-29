'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { WifiOff } from 'lucide-react'

export function OfflineToast() {
  const t = useTranslations('errors')
  const [isOffline, setIsOffline] = useState(false)

  useEffect(() => {
    const goOffline = () => setIsOffline(true)
    const goOnline = () => setIsOffline(false)

    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)

    setIsOffline(!navigator.onLine)

    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  if (!isOffline) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[70] bg-destructive text-destructive-foreground text-sm py-2 px-4 text-center flex items-center justify-center gap-2">
      <WifiOff className="h-4 w-4" />
      {t('offline')}
    </div>
  )
}
