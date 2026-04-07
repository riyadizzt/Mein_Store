'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Loader2, Shield, Eye, EyeOff, AlertCircle, Lock, ArrowLeft, Mail, CheckCircle2 } from 'lucide-react'
import { useAdminLogin } from '@/hooks/use-auth'
import { useAuthStore } from '@/store/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'

// ── Error message extraction ────────────────────────────────
function getErrorMessage(error: any, locale: string): string | null {
  if (!error) return null

  const status = error?.response?.status
  const msg = error?.response?.data?.message

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

  if (status === 401) {
    return locale === 'ar'
      ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
      : locale === 'en'
        ? 'Invalid email or password'
        : 'E-Mail oder Passwort falsch'
  }

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
  const login = useAdminLogin()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [roleError, setRoleError] = useState(false)

  // Forgot password state
  const [mode, setMode] = useState<'login' | 'forgot'>('login')
  const [resetEmail, setResetEmail] = useState('')
  const [resetSending, setResetSending] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetError, setResetError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setRoleError(false)

    try {
      await login.mutateAsync({ email, password })
      const adminUser = useAuthStore.getState().adminUser

      if (adminUser && ['admin', 'super_admin', 'warehouse_staff'].includes(adminUser.role)) {
        router.push(`/${locale}/admin/dashboard`)
      } else {
        useAuthStore.getState().adminLogout()
        setRoleError(true)
      }
    } catch (err: any) {
      if (err?.response?.data?.message === 'NOT_ADMIN') {
        setRoleError(true)
      }
    }
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!resetEmail.includes('@')) return
    setResetSending(true)
    setResetError('')
    try {
      await api.post('/auth/forgot-password', { email: resetEmail })
      setResetSent(true)
    } catch (err: any) {
      // Always show success for security (don't reveal if email exists)
      setResetSent(true)
    } finally {
      setResetSending(false)
    }
  }

  const switchToForgot = () => {
    setMode('forgot')
    setResetEmail(email) // pre-fill with login email
    setResetSent(false)
    setResetError('')
  }

  const switchToLogin = () => {
    setMode('login')
    setResetSent(false)
    setResetError('')
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

  const tt = (de: string, ar: string) => locale === 'ar' ? ar : de

  return (
    <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-background rounded-2xl p-8 shadow-2xl" style={{ animation: 'fadeSlideUp 400ms ease-out' }}>

          {mode === 'login' ? (
            <>
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

              {/* Login Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="text-sm font-medium mb-1.5 block">
                    {t('login.email')}
                  </label>
                  <Input
                    id="email"
                    type="email"
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="admin@malak-bekleidung.com"
                    className={`h-11 rounded-xl ${displayError ? 'border-red-300 focus-visible:ring-red-200' : ''}`}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="password" className="text-sm font-medium">
                      {t('login.password')}
                    </label>
                    <button
                      type="button"
                      onClick={switchToForgot}
                      className="text-xs text-[#d4a853] hover:underline"
                    >
                      {tt('Passwort vergessen?', 'نسيت كلمة المرور؟')}
                    </button>
                  </div>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      dir="ltr"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      className={`h-11 rounded-xl pr-11 ${displayError ? 'border-red-300 focus-visible:ring-red-200' : ''}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute top-1/2 -translate-y-1/2 right-3 text-muted-foreground hover:text-foreground transition-colors"
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
            </>
          ) : (
            <>
              {/* Forgot Password View */}
              <div className="text-center mb-8">
                <div className="h-14 w-14 rounded-2xl bg-[#1a1a2e] flex items-center justify-center mx-auto mb-4">
                  <Mail className="h-7 w-7 text-[#d4a853]" />
                </div>
                <h1 className="text-xl font-bold">{tt('Passwort zurücksetzen', 'إعادة تعيين كلمة المرور')}</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {tt('Geben Sie Ihre E-Mail-Adresse ein. Sie erhalten einen Link zum Zurücksetzen.', 'أدخل بريدك الإلكتروني. ستتلقى رابطاً لإعادة التعيين.')}
                </p>
              </div>

              {resetSent ? (
                /* Success State */
                <div className="text-center py-4">
                  <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="h-6 w-6 text-green-600" />
                  </div>
                  <p className="text-sm font-medium mb-1">
                    {tt('E-Mail gesendet!', 'تم إرسال البريد!')}
                  </p>
                  <p className="text-xs text-muted-foreground mb-6">
                    {tt(
                      'Falls die E-Mail registriert ist, erhalten Sie in Kürze einen Link zum Zurücksetzen.',
                      'إذا كان البريد مسجلاً، ستتلقى رابط إعادة التعيين قريباً.'
                    )}
                  </p>
                  <Button
                    onClick={switchToLogin}
                    variant="outline"
                    className="w-full h-11 rounded-xl gap-2"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    {tt('Zurück zum Login', 'العودة لتسجيل الدخول')}
                  </Button>
                </div>
              ) : (
                /* Email Input Form */
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  {resetError && (
                    <div className="p-3 rounded-xl bg-red-50 text-red-700 border border-red-200 text-sm">
                      {resetError}
                    </div>
                  )}

                  <div>
                    <label htmlFor="reset-email" className="text-sm font-medium mb-1.5 block">
                      {t('login.email')}
                    </label>
                    <Input
                      id="reset-email"
                      type="email"
                      dir="ltr"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      required
                      autoComplete="email"
                      placeholder="admin@malak-bekleidung.com"
                      className="h-11 rounded-xl"
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={resetSending || !resetEmail.includes('@')}
                    className="w-full h-11 rounded-xl bg-[#d4a853] text-white hover:bg-[#c49843] font-semibold text-sm transition-all gap-2"
                    size="lg"
                  >
                    {resetSending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Mail className="h-4 w-4" />
                        {tt('Link senden', 'إرسال الرابط')}
                      </>
                    )}
                  </Button>

                  <button
                    type="button"
                    onClick={switchToLogin}
                    className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1.5 pt-1"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    {tt('Zurück zum Login', 'العودة لتسجيل الدخول')}
                  </button>
                </form>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-white/30 mt-6">Malak Bekleidung &copy; 2026</p>
      </div>

      <style>{`
        @keyframes shake { 0%,100%{transform:translateX(0)} 15%{transform:translateX(-6px)} 30%{transform:translateX(5px)} 45%{transform:translateX(-4px)} 60%{transform:translateX(2px)} 75%{transform:translateX(-1px)} }
      `}</style>
    </div>
  )
}
