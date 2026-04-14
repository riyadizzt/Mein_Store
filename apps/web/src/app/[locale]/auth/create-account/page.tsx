'use client'

/**
 * Guest Account Claim — /auth/create-account
 *
 * Landing page for the invite link in the guest-invite.hbs email.
 * The guest already has a stub User row (passwordHash=null) and paid orders
 * linked to it. This page turns that into a real account by setting a
 * password, so the customer can log in later and see their history.
 *
 * Flow:
 *   1. Read token + email from URL query
 *   2. GET /auth/create-account?token=... → pre-fill firstName/lastName
 *   3. Show form (password, confirm, optional name edits)
 *   4. POST /auth/create-account with { token, password, firstName, lastName }
 *   5. Receive JWT → store → redirect to /account
 */

import { useEffect, useState, Suspense } from 'react'
import { useLocale } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Eye, EyeOff, CheckCircle2, AlertCircle } from 'lucide-react'
import { PasswordStrength } from '@/components/auth/password-strength'
import { Input } from '@/components/ui/input'
import { API_BASE_URL } from '@/lib/env'

function CreateAccountInner() {
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()

  const token = searchParams.get('token') ?? ''
  const emailFromUrl = searchParams.get('email') ?? ''

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [alreadyClaimed, setAlreadyClaimed] = useState(false)
  const [form, setForm] = useState({
    email: emailFromUrl,
    firstName: '',
    lastName: '',
    password: '',
    confirmPassword: '',
  })
  const [showPw, setShowPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Step 1: Validate the token and pre-fill names
  useEffect(() => {
    if (!token) {
      setTokenError(
        locale === 'ar'
          ? 'رابط غير صالح — الرمز مفقود'
          : locale === 'en'
            ? 'Invalid link — token missing'
            : 'Ungültiger Link — Token fehlt',
      )
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/v1/auth/create-account?token=${encodeURIComponent(token)}`,
          { method: 'GET' },
        )
        if (cancelled) return
        if (!res.ok) {
          setTokenError(
            locale === 'ar'
              ? 'الرابط غير صالح أو منتهي الصلاحية'
              : locale === 'en'
                ? 'Invalid or expired link'
                : 'Ungültiger oder abgelaufener Link',
          )
          setLoading(false)
          return
        }
        const data = await res.json()
        if (data.alreadyClaimed) {
          setAlreadyClaimed(true)
        }
        setForm((f) => ({
          ...f,
          email: data.email || emailFromUrl,
          firstName: data.firstName || '',
          lastName: data.lastName || '',
        }))
      } catch {
        if (!cancelled) {
          setTokenError(
            locale === 'ar'
              ? 'خطأ في الشبكة'
              : locale === 'en'
                ? 'Network error'
                : 'Netzwerkfehler',
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, emailFromUrl, locale])

  const validate = () => {
    const e: Record<string, string> = {}
    const required =
      locale === 'ar' ? 'حقل مطلوب' : locale === 'en' ? 'Required' : 'Pflichtfeld'
    if (!form.firstName.trim()) e.firstName = required
    if (!form.lastName.trim()) e.lastName = required
    if (form.password.length < 8)
      e.password =
        locale === 'ar'
          ? 'يجب أن تحتوي كلمة المرور على 8 أحرف على الأقل'
          : locale === 'en'
            ? 'Password must be at least 8 characters'
            : 'Passwort muss mindestens 8 Zeichen haben'
    if (
      !/(?=.*[0-9])(?=.*[!@#$%^&*])/.test(form.password) &&
      form.password.length >= 8
    ) {
      e.password =
        locale === 'ar'
          ? 'يجب أن تحتوي كلمة المرور على رقم ورمز خاص (!@#$%^&*)'
          : locale === 'en'
            ? 'Password must contain a number and special character (!@#$%^&*)'
            : 'Passwort muss eine Zahl und ein Sonderzeichen enthalten (!@#$%^&*)'
    }
    if (form.password !== form.confirmPassword) {
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

    setSubmitting(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/create-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          token,
          password: form.password,
          firstName: form.firstName,
          lastName: form.lastName,
        }),
      })
      if (!res.ok) {
        const errJson: any = await res.json().catch(() => ({}))
        setErrors({
          form:
            errJson.message ||
            (locale === 'ar'
              ? 'فشل إنشاء الحساب'
              : locale === 'en'
                ? 'Account creation failed'
                : 'Konto-Erstellung fehlgeschlagen'),
        })
        setSubmitting(false)
        return
      }
      const data = await res.json()
      // Store access token in localStorage (same pattern as register/login)
      if (data.accessToken) {
        try {
          localStorage.setItem('malak_at', data.accessToken)
        } catch {}
      }
      router.replace(`/${locale}/account`)
    } catch {
      setErrors({
        form:
          locale === 'ar'
            ? 'خطأ في الشبكة'
            : locale === 'en'
              ? 'Network error'
              : 'Netzwerkfehler',
      })
      setSubmitting(false)
    }
  }

  // ── Loading state ──
  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#d4a853]" />
      </div>
    )
  }

  // ── Token error state ──
  if (tokenError) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="h-20 w-20 rounded-full bg-red-50 flex items-center justify-center mx-auto">
            <AlertCircle className="h-10 w-10 text-red-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold mb-2">
              {locale === 'ar'
                ? 'رابط غير صالح'
                : locale === 'en'
                  ? 'Invalid Link'
                  : 'Ungültiger Link'}
            </h1>
            <p className="text-sm text-muted-foreground">{tokenError}</p>
          </div>
          <Link
            href={`/${locale}/auth/login`}
            className="inline-block px-6 py-3 rounded-full bg-[#d4a853] text-white font-semibold hover:bg-[#c29945] transition-colors"
          >
            {locale === 'ar'
              ? 'الذهاب إلى تسجيل الدخول'
              : locale === 'en'
                ? 'Go to Login'
                : 'Zum Login'}
          </Link>
        </div>
      </div>
    )
  }

  // ── Already claimed state ──
  if (alreadyClaimed) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="h-20 w-20 rounded-full bg-green-50 flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-10 w-10 text-green-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold mb-2">
              {locale === 'ar'
                ? 'الحساب مفعل بالفعل'
                : locale === 'en'
                  ? 'Account Already Active'
                  : 'Konto bereits aktiviert'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {locale === 'ar'
                ? 'لقد قمت بتفعيل هذا الحساب سابقاً. يرجى تسجيل الدخول.'
                : locale === 'en'
                  ? 'You have already activated this account. Please log in.'
                  : 'Du hast dieses Konto bereits aktiviert. Bitte einloggen.'}
            </p>
          </div>
          <Link
            href={`/${locale}/auth/login`}
            className="inline-block px-6 py-3 rounded-full bg-[#d4a853] text-white font-semibold hover:bg-[#c29945] transition-colors"
          >
            {locale === 'ar'
              ? 'تسجيل الدخول'
              : locale === 'en'
                ? 'Log In'
                : 'Einloggen'}
          </Link>
        </div>
      </div>
    )
  }

  // ── Main form ──
  return (
    <div className="min-h-[calc(100vh-120px)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-[#d4a853]/10 mb-4">
            <CheckCircle2 className="h-8 w-8 text-[#d4a853]" />
          </div>
          <h1 className="text-3xl font-bold mb-2" dir="ltr" style={{ fontFamily: 'Playfair Display, serif' }}>
            MALAK BEKLEIDUNG
          </h1>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            {locale === 'ar'
              ? 'مرحباً بك! أكمل إعداد حسابك لحفظ طلباتك وتفاصيلك.'
              : locale === 'en'
                ? 'Welcome! Finish setting up your account to save your orders and details.'
                : 'Willkommen! Schließe die Einrichtung deines Kontos ab, um deine Bestellungen und Details zu speichern.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 bg-white rounded-2xl p-8 shadow-lg border">
          {/* Email — read-only */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              {locale === 'ar' ? 'البريد الإلكتروني' : locale === 'en' ? 'Email' : 'E-Mail'}
            </label>
            <Input
              type="email"
              value={form.email}
              readOnly
              disabled
              className="bg-muted/30 cursor-not-allowed"
              dir="ltr"
            />
          </div>

          {/* First + last name */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                {locale === 'ar' ? 'الاسم الأول' : locale === 'en' ? 'First name' : 'Vorname'}
              </label>
              <Input
                type="text"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                disabled={submitting}
              />
              {errors.firstName && <p className="text-xs text-red-600 mt-1">{errors.firstName}</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                {locale === 'ar' ? 'اسم العائلة' : locale === 'en' ? 'Last name' : 'Nachname'}
              </label>
              <Input
                type="text"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                disabled={submitting}
              />
              {errors.lastName && <p className="text-xs text-red-600 mt-1">{errors.lastName}</p>}
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              {locale === 'ar' ? 'كلمة المرور' : locale === 'en' ? 'Password' : 'Passwort'}
            </label>
            <div className="relative">
              <Input
                type={showPw ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                disabled={submitting}
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
            {form.password && <PasswordStrength password={form.password} />}
          </div>

          {/* Confirm password */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              {locale === 'ar'
                ? 'تأكيد كلمة المرور'
                : locale === 'en'
                  ? 'Confirm password'
                  : 'Passwort bestätigen'}
            </label>
            <div className="relative">
              <Input
                type={showConfirmPw ? 'text' : 'password'}
                value={form.confirmPassword}
                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                disabled={submitting}
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
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
              {errors.form}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-14 rounded-full bg-[#d4a853] text-white font-semibold text-base hover:bg-[#c29945] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {locale === 'ar'
              ? 'إنشاء الحساب'
              : locale === 'en'
                ? 'Create Account'
                : 'Konto erstellen'}
          </button>

          <p className="text-center text-xs text-muted-foreground pt-2">
            {locale === 'ar'
              ? 'هل لديك حساب بالفعل؟'
              : locale === 'en'
                ? 'Already have an account?'
                : 'Hast du bereits ein Konto?'}{' '}
            <Link href={`/${locale}/auth/login`} className="text-[#d4a853] font-semibold hover:underline">
              {locale === 'ar' ? 'تسجيل الدخول' : locale === 'en' ? 'Log in' : 'Einloggen'}
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}

export default function CreateAccountPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#d4a853]" />
        </div>
      }
    >
      <CreateAccountInner />
    </Suspense>
  )
}
