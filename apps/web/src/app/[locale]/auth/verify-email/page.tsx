'use client'

/**
 * Email verification landing page.
 *
 * Bug fix history:
 *   - React StrictMode runs effects twice in dev. Without a ref-guard the
 *     API was called twice: first call consumed the one-time token, second
 *     call saw "not found" and painted a red "invalid" screen over the real
 *     success. Users saw the error every time.
 *   - After successful verify we also wipe the ?token= query param so a
 *     page refresh does not hit the now-empty token again.
 *   - The error screen used to dead-end with "request new link" even when
 *     the real cause was "already verified". It now offers BOTH paths with
 *     clear copy so the user never gets stuck.
 */

import { useEffect, useRef, useState, Suspense } from 'react'
import { useLocale } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'

type Status = 'loading' | 'success' | 'error' | 'no-token'

// Next.js 14 requires useSearchParams() to live inside a Suspense boundary.
// Without it the first render can return an empty params object and the
// token check fires with null → no-token screen instead of calling the API.
// Same pattern as /auth/create-account and /auth/reset-password.
function VerifyEmailInner() {
  const locale = useLocale()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [status, setStatus] = useState<Status>(() => (token ? 'loading' : 'no-token'))
  const [email, setEmail] = useState('')

  // Ref-guard: StrictMode runs the effect twice in development, and a user
  // refresh can also retrigger it. This ensures the API call happens EXACTLY
  // once per mount.
  //
  // SUBTLE BUG that was here before: we also had a local `cancelled` flag for
  // unmount cleanup. But StrictMode fires cleanup BETWEEN the two effect
  // runs, and cleanup set cancelled=true on the first closure. When the real
  // API response arrived, the .then/.catch handlers saw cancelled=true and
  // silently dropped the result → page stuck on "loading" forever.
  //
  // Solution: rely only on hasFired. React 18's setState on an unmounted
  // component is a no-op (warns in dev, does nothing in prod) — safe to
  // call without a cancelled guard. hasFired prevents the DOUBLE call, not
  // the single-call-on-unmount race, which doesn't matter here.
  const hasFired = useRef(false)

  useEffect(() => {
    if (!token) {
      setStatus('no-token')
      return
    }
    if (hasFired.current) return
    hasFired.current = true

    api
      .get(`/auth/verify-email?token=${token}`)
      .then(({ data }) => {
        setEmail(data?.email ?? '')
        setStatus('success')
        // Strip the token from the URL so a refresh does not retry and
        // land on the error screen.
        try {
          const url = new URL(window.location.href)
          url.searchParams.delete('token')
          window.history.replaceState({}, '', url.toString())
        } catch {}
      })
      .catch(() => {
        setStatus('error')
      })
  }, [token])

  const t = {
    loading: {
      title: { de: 'E-Mail wird verifiziert...', en: 'Verifying email...', ar: 'جارٍ التحقق من البريد الإلكتروني...' },
    },
    success: {
      title: { de: 'E-Mail erfolgreich bestätigt', en: 'Email verified successfully', ar: 'تم التحقق من البريد الإلكتروني' },
      sub: { de: 'Du kannst jetzt alle Funktionen nutzen.', en: 'You can now use all features.', ar: 'يمكنك الآن استخدام جميع الميزات.' },
      cta: { de: 'Zu meinem Konto', en: 'Go to my account', ar: 'الذهاب إلى حسابي' },
    },
    error: {
      title: { de: 'Link nicht mehr gültig', en: 'Link no longer valid', ar: 'الرابط لم يعد صالحاً' },
      sub: {
        de: 'Entweder wurde dieser Link bereits verwendet — dann ist dein Konto aktiv und du kannst dich einloggen. Oder er ist abgelaufen — dann fordere einen neuen Link an.',
        en: 'Either this link was already used — your account is active and you can log in. Or it has expired — request a fresh link.',
        ar: 'إما أن هذا الرابط قد تم استخدامه بالفعل - حسابك نشط ويمكنك تسجيل الدخول. أو أنه انتهت صلاحيته - اطلب رابطاً جديداً.',
      },
      login: { de: 'Einloggen', en: 'Log in', ar: 'تسجيل الدخول' },
      request: { de: 'Neuen Link anfordern', en: 'Request new link', ar: 'طلب رابط جديد' },
    },
    noToken: {
      title: { de: 'Kein Verifizierungs-Token', en: 'No verification token', ar: 'لا يوجد رمز تحقق' },
      sub: { de: 'Dieser Link scheint unvollständig zu sein.', en: 'This link appears to be incomplete.', ar: 'يبدو هذا الرابط غير مكتمل.' },
    },
  }

  const pick = (obj: any) => obj[locale as 'de' | 'en' | 'ar'] ?? obj.de

  return (
    <div className="min-h-[60vh] flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-sm text-center">
        {status === 'loading' && (
          <div style={{ animation: 'fadeIn 300ms ease-out' }}>
            <Loader2 className="h-12 w-12 mx-auto mb-4 text-[#d4a853] animate-spin" />
            <h1 className="text-xl font-bold">{pick(t.loading.title)}</h1>
          </div>
        )}

        {status === 'success' && (
          <div style={{ animation: 'fadeSlideUp 400ms ease-out' }}>
            <div className="h-20 w-20 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-5">
              <CheckCircle className="h-10 w-10 text-green-500" />
            </div>
            <h1 className="text-2xl font-bold mb-2">{pick(t.success.title)}</h1>
            {email && <p className="text-sm text-muted-foreground mb-1">{email}</p>}
            <p className="text-sm text-muted-foreground mb-6">{pick(t.success.sub)}</p>
            <Link
              href={`/${locale}/account`}
              className="inline-flex items-center justify-center h-12 px-8 rounded-full bg-[#d4a853] text-white font-semibold hover:bg-[#c29945] transition-colors"
            >
              {pick(t.success.cta)}
            </Link>
          </div>
        )}

        {(status === 'error' || status === 'no-token') && (
          <div style={{ animation: 'fadeSlideUp 400ms ease-out' }}>
            <div className="h-20 w-20 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-5">
              <AlertCircle className="h-10 w-10 text-amber-500" />
            </div>
            <h1 className="text-2xl font-bold mb-2">
              {status === 'error' ? pick(t.error.title) : pick(t.noToken.title)}
            </h1>
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
              {status === 'error' ? pick(t.error.sub) : pick(t.noToken.sub)}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href={`/${locale}/auth/login`}
                className="inline-flex items-center justify-center h-12 px-6 rounded-full bg-[#d4a853] text-white font-semibold hover:bg-[#c29945] transition-colors"
              >
                {pick(t.error.login)}
              </Link>
              {status === 'error' && (
                <Link
                  href={`/${locale}/auth/reset-password`}
                  className="inline-flex items-center justify-center h-12 px-6 rounded-full border-2 border-[#1a1a2e] text-[#1a1a2e] font-semibold hover:bg-muted/40 transition-colors"
                >
                  {pick(t.error.request)}
                </Link>
              )}
            </div>
          </div>
        )}

        <style>{`
          @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        `}</style>
      </div>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center">
          <Loader2 className="h-12 w-12 animate-spin text-[#d4a853]" />
        </div>
      }
    >
      <VerifyEmailInner />
    </Suspense>
  )
}
