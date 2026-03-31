'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Eye, EyeOff, AlertCircle, Lock, WifiOff } from 'lucide-react'
import { useLogin } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { GoogleSignIn } from '@/components/auth/google-sign-in'

function getErrorInfo(error: any, locale: string): { msg: string; icon: 'auth' | 'lock' | 'network'; showReset?: boolean } | null {
  if (!error) return null

  const status = error?.response?.status

  // Account locked (403)
  if (status === 403) {
    return {
      icon: 'lock',
      showReset: true,
      msg: locale === 'ar' ? 'الحساب مغلق مؤقتاً بسبب محاولات متعددة.'
        : locale === 'en' ? 'Account temporarily locked due to multiple attempts.'
        : 'Konto vorübergehend gesperrt wegen mehrfacher Fehlversuche.',
    }
  }

  // Wrong credentials (401)
  if (status === 401) {
    return {
      icon: 'auth',
      msg: locale === 'ar' ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
        : locale === 'en' ? 'Invalid email or password'
        : 'E-Mail oder Passwort falsch',
    }
  }

  // Network / server error
  if (error?.code === 'ERR_NETWORK' || !error?.response) {
    return {
      icon: 'network',
      msg: locale === 'ar' ? 'لا يمكن الاتصال بالخادم. يرجى المحاولة لاحقاً.'
        : locale === 'en' ? 'Cannot connect to server. Please try again later.'
        : 'Verbindung zum Server fehlgeschlagen. Bitte versuchen Sie es später erneut.',
    }
  }

  return {
    icon: 'auth',
    msg: locale === 'ar' ? 'حدث خطأ غير متوقع' : locale === 'en' ? 'An unexpected error occurred' : 'Ein unerwarteter Fehler ist aufgetreten',
  }
}

export default function LoginPage() {
  const t = useTranslations('auth')
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect')

  const login = useLogin()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await login.mutateAsync({ email, password })
      router.push(redirect ? `/${locale}/${redirect}` : `/${locale}/account`)
    } catch {
      // error displayed via login.error
    }
  }

  const errorInfo = getErrorInfo(login.error, locale)
  const ErrorIcon = errorInfo?.icon === 'lock' ? Lock : errorInfo?.icon === 'network' ? WifiOff : AlertCircle

  return (
    <div className="min-h-[60vh] flex items-center justify-center py-12">
      <div className="w-full max-w-sm px-4">
        <h1 className="text-2xl font-bold text-center mb-8">{t('loginTitle')}</h1>

        {errorInfo && (
          <div
            className={`mb-4 p-3.5 rounded-xl text-sm ${
              errorInfo.icon === 'lock' ? 'bg-orange-50 text-orange-800 border border-orange-200'
              : errorInfo.icon === 'network' ? 'bg-blue-50 text-blue-800 border border-blue-200'
              : 'bg-red-50 text-red-700 border border-red-200'
            }`}
            role="alert"
            style={{ animation: 'shake 400ms ease-out' }}
          >
            <div className="flex items-start gap-3">
              <ErrorIcon className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{errorInfo.msg}</span>
            </div>
            {errorInfo.showReset && (
              <Link
                href={`/${locale}/auth/reset-password`}
                className="mt-2 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-orange-100 text-orange-900 text-xs font-semibold hover:bg-orange-200 transition-colors"
              >
                {locale === 'ar' ? 'إعادة تعيين كلمة المرور لإلغاء القفل' : locale === 'en' ? 'Reset password to unlock' : 'Passwort zurücksetzen zum Entsperren'}
              </Link>
            )}
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
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="ltr:pr-10 rtl:pl-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute top-1/2 -translate-y-1/2 ltr:right-3 rtl:left-3 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
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

      <style>{`
        @keyframes shake { 0%,100%{transform:translateX(0)} 15%{transform:translateX(-6px)} 30%{transform:translateX(5px)} 45%{transform:translateX(-4px)} 60%{transform:translateX(2px)} }
      `}</style>
    </div>
  )
}
