'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Loader2, Shield, Eye, EyeOff, AlertCircle, Lock } from 'lucide-react'
import { useLogin } from '@/hooks/use-auth'
import { useAuthStore } from '@/store/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// ── Error message extraction ────────────────────────────────
function getErrorMessage(error: any, locale: string): string | null {
  if (!error) return null

  const status = error?.response?.status
  const msg = error?.response?.data?.message

  // Account locked (403)
  if (status === 403) {
    if (typeof msg === 'string' && msg.includes('gesperrt')) {
      return locale === 'ar'
        ? 'الحساب مغلق مؤقتاً بسبب محاولات تسجيل دخول متعددة. يرجى الانتظار.'
        : locale === 'en'
          ? 'Account temporarily locked due to multiple failed attempts. Please wait.'
          : msg
    }
    if (typeof msg === 'string' && msg.includes('deaktiviert')) {
      return locale === 'ar'
        ? 'الحساب معطل. يرجى التواصل مع المسؤول.'
        : locale === 'en'
          ? 'Account deactivated. Please contact support.'
          : msg
    }
    return msg || (locale === 'ar' ? 'الوصول مرفوض' : locale === 'en' ? 'Access denied' : 'Zugriff verweigert')
  }

  // Wrong credentials (401)
  if (status === 401) {
    return locale === 'ar'
      ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
      : locale === 'en'
        ? 'Invalid email or password'
        : 'E-Mail oder Passwort falsch'
  }

  // Network error
  if (error?.code === 'ERR_NETWORK' || !error?.response) {
    return locale === 'ar'
      ? 'لا يمكن الاتصال بالخادم'
      : locale === 'en'
        ? 'Cannot connect to server'
        : 'Verbindung zum Server fehlgeschlagen'
  }

  return locale === 'ar' ? 'حدث خطأ غير متوقع' : locale === 'en' ? 'An unexpected error occurred' : 'Ein unerwarteter Fehler ist aufgetreten'
}

// ── Page ────────────────────────────────────────────────────
export default function AdminLoginPage() {
  const locale = useLocale()
  const t = useTranslations('admin')
  const router = useRouter()
  const login = useLogin()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [roleError, setRoleError] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setRoleError(false)

    try {
      await login.mutateAsync({ email, password })
      const currentUser = useAuthStore.getState().user

      if (currentUser && ['admin', 'super_admin'].includes(currentUser.role)) {
        router.push(`/${locale}/admin/dashboard`)
      } else {
        // User exists but is not admin
        useAuthStore.getState().logout()
        setRoleError(true)
      }
    } catch {
      // Error is in login.error — displayed below
    }
  }

  const errorMsg = getErrorMessage(login.error, locale)
  const isLocked = (login.error as any)?.response?.status === 403

  const roleErrorMsg = roleError
    ? locale === 'ar'
      ? 'ليس لديك صلاحيات الوصول إلى لوحة الإدارة'
      : locale === 'en'
        ? 'You do not have admin access'
        : 'Sie haben keinen Admin-Zugang'
    : null

  const displayError = roleErrorMsg || errorMsg

  return (
    <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-background rounded-2xl p-8 shadow-2xl" style={{ animation: 'fadeSlideUp 400ms ease-out' }}>
          {/* Header */}
          <div className="text-center mb-8">
            <div className="h-14 w-14 rounded-2xl bg-[#1a1a2e] flex items-center justify-center mx-auto mb-4">
              <Shield className="h-7 w-7 text-[#d4a853]" />
            </div>
            <h1 className="text-xl font-bold">Malak Admin</h1>
            <p className="text-sm text-muted-foreground mt-1">{t('login.subtitle')}</p>
          </div>

          {/* Error */}
          {displayError && (
            <div
              className={`mb-5 flex items-start gap-3 p-3.5 rounded-xl text-sm ${
                isLocked
                  ? 'bg-orange-50 text-orange-800 border border-orange-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}
              style={{ animation: 'shake 400ms ease-out' }}
            >
              {isLocked ? <Lock className="h-4 w-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />}
              <span>{displayError}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="text-sm font-medium mb-1.5 block">
                {t('login.email')}
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="admin@malak-bekleidung.com"
                className={`h-11 rounded-xl ${displayError ? 'border-red-300 focus-visible:ring-red-200' : ''}`}
              />
            </div>
            <div>
              <label htmlFor="password" className="text-sm font-medium mb-1.5 block">
                {t('login.password')}
              </label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className={`h-11 rounded-xl ltr:pr-11 rtl:pl-11 ${displayError ? 'border-red-300 focus-visible:ring-red-200' : ''}`}
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

            <Button
              type="submit"
              disabled={login.isPending || !email || !password}
              className="w-full h-11 rounded-xl bg-[#d4a853] text-white hover:bg-[#c49843] font-semibold text-sm transition-all"
              size="lg"
            >
              {login.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t('login.loginBtn')
              )}
            </Button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-white/30 mt-6">Malak Bekleidung &copy; 2026</p>
      </div>

      <style>{`
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes shake { 0%,100%{transform:translateX(0)} 15%{transform:translateX(-6px)} 30%{transform:translateX(5px)} 45%{transform:translateX(-4px)} 60%{transform:translateX(2px)} 75%{transform:translateX(-1px)} }
      `}</style>
    </div>
  )
}
