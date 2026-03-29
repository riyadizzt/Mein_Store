'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Loader2, Shield } from 'lucide-react'
import { useLogin } from '@/hooks/use-auth'
import { useAuthStore } from '@/store/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function AdminLoginPage() {
  const locale = useLocale()
  const t = useTranslations('admin')
  const router = useRouter()
  const login = useLogin()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await login.mutateAsync({ email, password })
      // Check role after login
      const currentUser = useAuthStore.getState().user
      if (currentUser && ['admin', 'super_admin'].includes(currentUser.role)) {
        router.push(`/${locale}/admin/dashboard`)
      } else {
        useAuthStore.getState().logout()
      }
    } catch {
      // handled by mutation
    }
  }

  const error = login.error as any
  const errorMsg = error?.response?.data?.message

  return (
    <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center">
      <div className="w-full max-w-sm px-4">
        <div className="bg-background rounded-2xl p-8 shadow-elevated">
          <div className="text-center mb-8">
            <Shield className="h-10 w-10 text-primary mx-auto mb-3" />
            <h1 className="text-xl font-bold">{t('login.title')}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t('login.subtitle')}</p>
          </div>

          {errorMsg && (
            <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-sm text-destructive text-center">
              {t('login.invalidCredentials')}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="text-sm font-medium mb-1.5 block">{t('login.email')}</label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div>
              <label htmlFor="password" className="text-sm font-medium mb-1.5 block">{t('login.password')}</label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            </div>
            <Button type="submit" disabled={login.isPending} className="w-full bg-accent text-accent-foreground hover:bg-accent/90" size="lg">
              {login.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {t('login.loginBtn')}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
