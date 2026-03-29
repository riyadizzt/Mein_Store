'use client'

import { useTranslations } from 'next-intl'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('errors')

  return (
    <div className="min-h-[60vh] flex items-center justify-center py-16">
      <div className="max-w-md w-full text-center px-4">
        <AlertTriangle className="h-16 w-16 text-destructive/40 mx-auto mb-6" />
        <h1 className="text-2xl font-bold mb-2">{t('serverError')}</h1>
        <p className="text-muted-foreground mb-8">{t('serverErrorMessage')}</p>
        <div className="flex gap-3 justify-center">
          <Button onClick={reset}>{t('tryAgain')}</Button>
          <Button variant="outline" onClick={() => (window.location.href = '/')}>
            {t('backToHome')}
          </Button>
        </div>
      </div>
    </div>
  )
}
