'use client'

import { useState, useEffect } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'

const COOKIE_CONSENT_KEY = 'malak-cookie-consent'

export function CookieBanner() {
  const t = useTranslations('cookie')
  const locale = useLocale()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const consent = localStorage.getItem(COOKIE_CONSENT_KEY)
    if (!consent) setVisible(true)
  }, [])

  const accept = (level: 'essential' | 'all') => {
    localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify({ level, date: new Date().toISOString() }))
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[60] bg-background border-t shadow-lg lg:bottom-0 mb-16 lg:mb-0">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex-1 text-sm text-muted-foreground">
            <p>
              {t('message')}{' '}
              <a href={`/${locale}/legal/datenschutz`} className="underline hover:text-foreground">
                {t('privacyLink')}
              </a>
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="outline" size="sm" onClick={() => accept('essential')}>
              {t('essentialOnly')}
            </Button>
            <Button size="sm" onClick={() => accept('all')}>
              {t('acceptAll')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
