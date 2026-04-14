'use client'

/**
 * Password reset — dual-mode page.
 *
 * No ?token= → customer enters email → we queue the reset email (existing flow)
 * ?token=...  → customer enters the NEW password → token is consumed on submit
 *
 * The backend queuePasswordReset in email.service.ts links here directly with
 * the token appended. Before today the link was `/reset-password` (404) and
 * the token-form page (`/auth/new-password`) existed as an empty directory,
 * so password recovery was completely broken.
 */

import { useState, Suspense } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Loader2, CheckCircle2, Eye, EyeOff, AlertCircle } from 'lucide-react'
import { useForgotPassword, useResetPassword } from '@/hooks/use-auth'
import { PasswordStrength } from '@/components/auth/password-strength'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function ResetPasswordInner() {
  const t = useTranslations('auth')
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  // ── Token flow (set new password) ──
  if (token) {
    return <NewPasswordForm token={token} locale={locale} router={router} />
  }

  // ── Email flow (request reset link) ──
  return <RequestResetForm locale={locale} t={t} />
}

function RequestResetForm({ locale, t }: { locale: string; t: any }) {
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
            <p className="text-sm text-muted-foreground mb-6">{t('resetSentMessage')}</p>
            <Link href={`/${locale}/auth/login`}>
              <Button variant="outline">{t('backToLogin')}</Button>
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold mb-2">{t('resetTitle')}</h1>
            <p className="text-sm text-muted-foreground mb-6">{t('resetSentMessage')}</p>
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

function NewPasswordForm({
  token,
  locale,
  router,
}: {
  token: string
  locale: string
  router: ReturnType<typeof useRouter>
}) {
  const reset = useResetPassword()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [done, setDone] = useState(false)

  const validate = () => {
    const e: Record<string, string> = {}
    if (password.length < 8) {
      e.password =
        locale === 'ar'
          ? 'يجب أن تحتوي كلمة المرور على 8 أحرف على الأقل'
          : locale === 'en'
            ? 'Password must be at least 8 characters'
            : 'Passwort muss mindestens 8 Zeichen haben'
    } else if (!/(?=.*[0-9])(?=.*[!@#$%^&*])/.test(password)) {
      e.password =
        locale === 'ar'
          ? 'يجب أن تحتوي على رقم ورمز خاص (!@#$%^&*)'
          : locale === 'en'
            ? 'Must contain a number and special character (!@#$%^&*)'
            : 'Muss eine Zahl und ein Sonderzeichen enthalten (!@#$%^&*)'
    }
    if (password !== confirmPassword) {
      e.confirmPassword =
        locale === 'ar'
          ? 'كلمات المرور غير متطابقة'
          : locale === 'en'
            ? 'Passwords do not match'
            : 'Passwörter stimmen nicht überein'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    try {
      await reset.mutateAsync({ token, password })
      setDone(true)
      setTimeout(() => router.replace(`/${locale}/auth/login`), 2000)
    } catch (err: any) {
      setErrors({
        form:
          err?.response?.data?.message ||
          (locale === 'ar'
            ? 'الرابط غير صالح أو منتهي الصلاحية'
            : locale === 'en'
              ? 'Invalid or expired link'
              : 'Ungültiger oder abgelaufener Link'),
      })
    }
  }

  if (done) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center py-12">
        <div className="w-full max-w-sm px-4 text-center">
          <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">
            {locale === 'ar'
              ? 'تم تحديث كلمة المرور'
              : locale === 'en'
                ? 'Password updated'
                : 'Passwort aktualisiert'}
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            {locale === 'ar'
              ? 'جارٍ إعادة توجيهك إلى تسجيل الدخول...'
              : locale === 'en'
                ? 'Redirecting you to login...'
                : 'Du wirst zum Login weitergeleitet...'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center py-12">
      <div className="w-full max-w-sm px-4">
        <h1 className="text-2xl font-bold mb-2 text-center">
          {locale === 'ar'
            ? 'كلمة مرور جديدة'
            : locale === 'en'
              ? 'New password'
              : 'Neues Passwort'}
        </h1>
        <p className="text-sm text-muted-foreground mb-6 text-center">
          {locale === 'ar'
            ? 'أدخل كلمة المرور الجديدة لحسابك'
            : locale === 'en'
              ? 'Enter the new password for your account'
              : 'Gib das neue Passwort für dein Konto ein'}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4 text-start">
          <div>
            <label className="text-sm font-medium mb-1.5 block">
              {locale === 'ar' ? 'كلمة المرور' : locale === 'en' ? 'Password' : 'Passwort'}
            </label>
            <div className="relative">
              <Input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute ltr:right-3 rtl:left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.password && <p className="text-xs text-red-600 mt-1">{errors.password}</p>}
            {password && <PasswordStrength password={password} />}
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">
              {locale === 'ar'
                ? 'تأكيد كلمة المرور'
                : locale === 'en'
                  ? 'Confirm password'
                  : 'Passwort bestätigen'}
            </label>
            <div className="relative">
              <Input
                type={showConfirmPw ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPw((v) => !v)}
                className="absolute ltr:right-3 rtl:left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showConfirmPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.confirmPassword && (
              <p className="text-xs text-red-600 mt-1">{errors.confirmPassword}</p>
            )}
          </div>
          {errors.form && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{errors.form}</span>
            </div>
          )}
          <Button type="submit" disabled={reset.isPending} className="w-full" size="lg">
            {reset.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {locale === 'ar' ? 'حفظ' : locale === 'en' ? 'Save' : 'Speichern'}
          </Button>
        </form>
        <div className="text-center mt-4">
          <Link href={`/${locale}/auth/login`} className="text-sm text-muted-foreground hover:text-foreground">
            {locale === 'ar' ? 'العودة لتسجيل الدخول' : locale === 'en' ? 'Back to login' : 'Zurück zum Login'}
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#d4a853]" />
        </div>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  )
}
