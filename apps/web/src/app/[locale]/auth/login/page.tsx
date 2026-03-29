'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { useLogin } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { GoogleSignIn } from '@/components/auth/google-sign-in'

export default function LoginPage() {
  const t = useTranslations('auth')
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect')

  const login = useLogin()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await login.mutateAsync({ email, password })
      router.push(redirect ? `/${locale}/${redirect}` : `/${locale}/account`)
    } catch {
      // error handled by mutation
    }
  }

  const error = login.error as any
  const errorMsg = error?.response?.data?.message

  return (
    <div className="min-h-[60vh] flex items-center justify-center py-12">
      <div className="w-full max-w-sm px-4">
        <h1 className="text-2xl font-bold text-center mb-8">{t('loginTitle')}</h1>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-sm text-destructive" role="alert" aria-live="polite">
            {typeof errorMsg === 'string' ? errorMsg : errorMsg[locale] ?? errorMsg.de ?? t('errors.invalidCredentials')}
          </div>
        )}

        <div className="space-y-4 border rounded-2xl p-8 shadow-card">
          {/* Google Sign-In */}
          <GoogleSignIn label={`Google ${t('loginButton')}`} />

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
            <div className="relative flex justify-center text-xs uppercase"><span className="bg-background px-4 text-muted-foreground">{t('loginButton')}</span></div>
          </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="text-sm font-medium mb-1.5 block">{t('email')}</label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="password" className="text-sm font-medium">{t('password')}</label>
              <Link href={`/${locale}/auth/reset-password`} className="text-xs text-primary hover:underline">
                {t('forgotPassword')}
              </Link>
            </div>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </div>

          <Button type="submit" disabled={login.isPending} className="w-full bg-accent text-accent-foreground rounded-xl h-12 hover:bg-accent/90" size="lg">
            {login.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {t('loginButton')}
          </Button>
        </form>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t('noAccount')}{' '}
          <Link href={`/${locale}/auth/register`} className="text-primary font-medium hover:underline">
            {t('registerButton')}
          </Link>
        </p>
      </div>
    </div>
  )
}
