'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import Link from 'next/link'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { useForgotPassword } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function ResetPasswordPage() {
  const t = useTranslations('auth')
  const locale = useLocale()
  const forgot = useForgotPassword()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await forgot.mutateAsync(email)
    setSent(true)
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center py-12">
      <div className="w-full max-w-sm px-4 text-center">
        {sent ? (
          <>
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h1 className="text-xl font-bold mb-2">{t('resetSent')}</h1>
            <p className="text-sm text-muted-foreground mb-6">
              {t('resetSentMessage')}
            </p>
            <Link href={`/${locale}/auth/login`}>
              <Button variant="outline">{t('backToLogin')}</Button>
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold mb-2">{t('resetTitle')}</h1>
            <p className="text-sm text-muted-foreground mb-6">
              {t('resetSentMessage')}
            </p>
            <form onSubmit={handleSubmit} className="space-y-4 text-start">
              <div>
                <label htmlFor="email" className="text-sm font-medium mb-1.5 block">{t('email')}</label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <Button type="submit" disabled={forgot.isPending} className="w-full" size="lg">
                {forgot.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {t('sendResetLink')}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
