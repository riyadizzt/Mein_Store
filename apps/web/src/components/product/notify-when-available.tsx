'use client'

import { API_BASE_URL } from '@/lib/env'
import { useState } from 'react'
import { Bell, Check, Loader2 } from 'lucide-react'

interface Props {
  productId: string
  variantId?: string
  locale: string
}

export function NotifyWhenAvailable({ productId, variantId, locale }: Props) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  const t = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.includes('@')) return
    setStatus('loading')
    try {
      await fetch(`${API_BASE_URL}/api/v1/newsletter/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'stock_notify', productId, variantId }),
      })
      setStatus('success')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="flex items-center gap-2.5 p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-sm">
        <Check className="h-4 w-4 text-green-600 flex-shrink-0" />
        <span className="text-green-700 dark:text-green-400">
          {t('Wir benachrichtigen dich, wenn der Artikel wieder verfügbar ist.', 'We\'ll notify you when this item is back in stock.', 'سنعلمك عندما يتوفر المنتج مجدداً.')}
        </span>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="p-3 rounded-xl bg-muted/30 border border-border/50">
      <div className="flex items-center gap-2 mb-2">
        <Bell className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">
          {t('Benachrichtigung bei Verfügbarkeit', 'Notify me when available', 'أعلمني عند التوفر')}
        </span>
      </div>
      <div className="flex gap-2">
        <input
          type="email"
          dir="ltr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('Deine E-Mail', 'Your email', 'بريدك الإلكتروني')}
          required
          className="flex-1 h-10 px-3 rounded-xl border bg-background text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        <button
          type="submit"
          disabled={status === 'loading' || !email.includes('@')}
          className="h-10 px-4 rounded-xl bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          {status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
          {t('Senden', 'Notify', 'إرسال')}
        </button>
      </div>
      {status === 'error' && (
        <p className="text-xs text-destructive mt-1.5">{t('Fehler. Bitte erneut versuchen.', 'Error. Please try again.', 'خطأ. يرجى المحاولة مرة أخرى.')}</p>
      )}
    </form>
  )
}
