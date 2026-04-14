'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Eye, EyeOff, AlertCircle, Lock, WifiOff, ShieldAlert } from 'lucide-react'
import { useLogin } from '@/hooks/use-auth'
import { Input } from '@/components/ui/input'
import { GoogleSignIn } from '@/components/auth/google-sign-in'
import { FacebookSignIn } from '@/components/auth/facebook-sign-in'

function getErrorInfo(error: any, locale: string): {
  msg: string
  icon: 'auth' | 'lock' | 'network' | 'blocked'
  showReset?: boolean
  showContact?: boolean
} | null {
  if (!error) return null

  const status = error?.response?.status
  const body = error?.response?.data
  const errorCode = body?.error
  // Backend returns localized message object for AccountBlocked
  const localizedMsg = typeof body?.message === 'object'
    ? body.message[locale] ?? body.message.de
    : null

  // Admin-blocked account — specific error code from backend
  if (status === 403 && errorCode === 'AccountBlocked') {
    return {
      icon: 'blocked',
      showContact: true,
      msg: localizedMsg
        ?? (locale === 'ar' ? 'تم حظر حسابك من قبل خدمة العملاء. يرجى التواصل معنا.'
          : locale === 'en' ? 'Your account has been blocked by customer service. Please contact us.'
          : 'Dein Konto wurde vom Kundenservice gesperrt. Bitte kontaktiere uns.'),
    }
  }

  if (status === 403) {
    return {
      icon: 'lock',
      showReset: true,
      msg: locale === 'ar' ? 'الحساب مغلق مؤقتاً بسبب محاولات متعددة.'
        : locale === 'en' ? 'Account temporarily locked due to multiple attempts.'
        : 'Konto vorübergehend gesperrt wegen mehrfacher Fehlversuche.',
    }
  }

  if (status === 401) {
    return {
      icon: 'auth',
      msg: locale === 'ar' ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
        : locale === 'en' ? 'Invalid email or password'
        : 'E-Mail oder Passwort falsch',
    }
  }

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
  // OAuth callbacks (Google/Facebook) redirect here with ?error=... when
  // login fails. account_blocked is the one we want to surface as a friendly
  // "contact support" screen, everything else is just a generic failure.
  const oauthError = searchParams.get('error')

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

  // Synthesize an errorInfo from ?error= query param when present — same
  // shape as getErrorInfo so the render path below stays single-branch.
  const oauthErrorInfo: ReturnType<typeof getErrorInfo> = oauthError === 'account_blocked'
    ? {
        icon: 'blocked',
        showContact: true,
        msg: locale === 'ar'
          ? 'تم حظر حسابك من قبل خدمة العملاء. يرجى التواصل معنا.'
          : locale === 'en'
            ? 'Your account has been blocked by customer service. Please contact us.'
            : 'Dein Konto wurde vom Kundenservice gesperrt. Bitte kontaktiere uns.',
      }
    : (oauthError === 'google_failed' || oauthError === 'facebook_failed')
      ? {
          icon: 'auth',
          msg: locale === 'ar'
            ? 'فشل تسجيل الدخول عبر المنصة الاجتماعية'
            : locale === 'en'
              ? 'Social login failed. Please try again.'
              : 'Social Login fehlgeschlagen. Bitte versuche es erneut.',
        }
      : null

  const errorInfo = getErrorInfo(login.error, locale) ?? oauthErrorInfo
  const ErrorIcon =
    errorInfo?.icon === 'blocked' ? ShieldAlert
    : errorInfo?.icon === 'lock' ? Lock
    : errorInfo?.icon === 'network' ? WifiOff
    : AlertCircle

  return (
    <div className="min-h-[70vh] flex items-center justify-center py-16 bg-[#fafafa]">
      <div className="w-full max-w-[420px] px-4">

        {/* Logo */}
        <div className="text-center mb-10">
          <Link href={`/${locale}`} className="inline-block">
            <span className="text-2xl font-display font-bold text-[#0f1419] tracking-[0.3em]">MALAK</span>
          </Link>
          <p className="text-sm text-[#0f1419]/40 mt-2 tracking-wide">BEKLEIDUNG</p>
        </div>

        {/* Error */}
        {errorInfo && (
          <div
            className={`mb-6 p-4 rounded-xl text-sm ${
              errorInfo.icon === 'blocked' ? 'bg-red-50 text-red-900 border border-red-200'
              : errorInfo.icon === 'lock' ? 'bg-orange-50 text-orange-800 border border-orange-200'
              : errorInfo.icon === 'network' ? 'bg-blue-50 text-blue-800 border border-blue-200'
              : 'bg-red-50 text-red-700 border border-red-200'
            }`}
            role="alert"
            style={{ animation: 'shake 400ms ease-out' }}
          >
            <div className="flex items-start gap-3">
              <ErrorIcon className={`h-5 w-5 mt-0.5 flex-shrink-0 ${errorInfo.icon === 'blocked' ? 'text-red-600' : ''}`} />
              <span className={errorInfo.icon === 'blocked' ? 'leading-relaxed font-medium' : ''}>{errorInfo.msg}</span>
            </div>
            {errorInfo.showReset && (
              <Link
                href={`/${locale}/auth/reset-password`}
                className="mt-3 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-orange-100 text-orange-900 text-xs font-semibold hover:bg-orange-200 transition-colors"
              >
                {locale === 'ar' ? 'إعادة تعيين كلمة المرور لإلغاء القفل' : locale === 'en' ? 'Reset password to unlock' : 'Passwort zurücksetzen zum Entsperren'}
              </Link>
            )}
            {errorInfo.showContact && (
              <Link
                href={`/${locale}/contact`}
                className="mt-3 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-white border border-red-300 text-red-900 text-sm font-semibold hover:bg-red-50 transition-colors"
              >
                {locale === 'ar' ? 'التواصل مع خدمة العملاء' : locale === 'en' ? 'Contact customer service' : 'Kundenservice kontaktieren'}
              </Link>
            )}
          </div>
        )}

        {/* Form Card */}
        <div className="bg-white rounded-2xl shadow-lg border border-[#e5e5e5]/50 p-8 sm:p-10 space-y-6">

          <h1 className="text-xl font-semibold text-center text-[#0f1419]">{t('loginTitle')}</h1>

          {/* Social Login */}
          <div className="space-y-3">
            <GoogleSignIn label={locale === 'ar' ? 'تسجيل الدخول من خلال Google' : locale === 'en' ? 'Sign in with Google' : 'Mit Google anmelden'} />
            <FacebookSignIn label={locale === 'ar' ? 'تسجيل الدخول من خلال Facebook' : locale === 'en' ? 'Sign in with Facebook' : 'Mit Facebook anmelden'} />
          </div>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-[#e5e5e5]" /></div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-4 text-[#0f1419]/30">
                {locale === 'ar' ? 'أو' : locale === 'en' ? 'or' : 'oder'}
              </span>
            </div>
          </div>

          {/* Email Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="text-sm font-medium text-[#0f1419]/70 mb-2 block">{t('email')}</label>
              <Input
                id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                required autoComplete="email"
                className="h-12 rounded-xl border-[#e0e0e0] focus:border-[#d4a853] focus:ring-[#d4a853]/20 text-base"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="password" className="text-sm font-medium text-[#0f1419]/70">{t('password')}</label>
                <Link href={`/${locale}/auth/reset-password`} className="text-xs text-[#d4a853] hover:text-[#c49b45] transition-colors">
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
                  className="h-12 rounded-xl border-[#e0e0e0] focus:border-[#d4a853] focus:ring-[#d4a853]/20 text-base ltr:pr-12 rtl:pl-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute top-1/2 -translate-y-1/2 ltr:right-4 rtl:left-4 text-[#0f1419]/30 hover:text-[#0f1419]/60 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={login.isPending}
              className="w-full h-14 rounded-xl bg-[#d4a853] text-white text-lg font-semibold hover:bg-[#c49b45] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {login.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('loginButton')}
            </button>
          </form>
        </div>

        {/* Register link */}
        <p className="mt-8 text-center text-sm text-[#0f1419]/50">
          {t('noAccount')}{' '}
          <Link href={`/${locale}/auth/register`} className="text-[#d4a853] font-medium hover:text-[#c49b45] transition-colors">
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
