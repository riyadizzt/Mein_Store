'use client'

/**
 * Path-based email verification — /auth/verify-email/[token]
 *
 * Why a path segment instead of ?token= query string:
 * Email trackers (Resend click tracking, Gmail link rewriting, Outlook Safe
 * Links) sometimes strip or re-encode query strings during click redirects.
 * Customers would see "Kein Verifizierungs-Token" even though the HTML link
 * looked clean when copied. Path segments survive every tracker untouched.
 *
 * This is the PRIMARY route. The old /auth/verify-email?token=... still
 * works as a fallback for any links already in customer inboxes.
 */

import { useEffect, useRef, useState } from 'react'
import { useLocale } from 'next-intl'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'

type Status = 'loading' | 'success' | 'error'

export default function VerifyEmailTokenPage() {
  const locale = useLocale()
  const params = useParams()
  const token = (params?.token as string | undefined) ?? ''

  const [status, setStatus] = useState<Status>('loading')
  const [email, setEmail] = useState('')
  const hasFired = useRef(false)

  useEffect(() => {
    if (!token) {
      setStatus('error')
      return
    }
    if (hasFired.current) return
    hasFired.current = true

    api
      .get(`/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(({ data }) => {
        setEmail(data?.email ?? '')
        setStatus('success')
      })
      .catch(() => {
        setStatus('error')
      })
  }, [token])

  const t = {
    loading: { de: 'E-Mail wird verifiziert...', en: 'Verifying email...', ar: 'جارٍ التحقق من البريد الإلكتروني...' },
    successTitle: { de: 'E-Mail erfolgreich bestätigt', en: 'Email verified successfully', ar: 'تم التحقق من البريد الإلكتروني' },
    successSub: { de: 'Du kannst jetzt alle Funktionen nutzen.', en: 'You can now use all features.', ar: 'يمكنك الآن استخدام جميع الميزات.' },
    successCta: { de: 'Zu meinem Konto', en: 'Go to my account', ar: 'الذهاب إلى حسابي' },
    errorTitle: { de: 'Link nicht mehr gültig', en: 'Link no longer valid', ar: 'الرابط لم يعد صالحاً' },
    errorSub: {
      de: 'Entweder wurde dieser Link bereits verwendet — dann ist dein Konto aktiv und du kannst dich einloggen. Oder er ist abgelaufen — dann fordere einen neuen Link an.',
      en: 'Either this link was already used — your account is active and you can log in. Or it has expired — request a fresh link.',
      ar: 'إما أن هذا الرابط قد تم استخدامه بالفعل - حسابك نشط ويمكنك تسجيل الدخول. أو أنه انتهت صلاحيته - اطلب رابطاً جديداً.',
    },
    login: { de: 'Einloggen', en: 'Log in', ar: 'تسجيل الدخول' },
    request: { de: 'Neuen Link anfordern', en: 'Request new link', ar: 'طلب رابط جديد' },
  }

  const pick = (obj: any) => obj[locale as 'de' | 'en' | 'ar'] ?? obj.de

  return (
    <div className="min-h-[60vh] flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-sm text-center">
        {status === 'loading' && (
          <div style={{ animation: 'fadeIn 300ms ease-out' }}>
            <Loader2 className="h-12 w-12 mx-auto mb-4 text-[#d4a853] animate-spin" />
            <h1 className="text-xl font-bold">{pick(t.loading)}</h1>
          </div>
        )}

        {status === 'success' && (
          <div style={{ animation: 'fadeSlideUp 400ms ease-out' }}>
            <div className="h-20 w-20 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-5">
              <CheckCircle className="h-10 w-10 text-green-500" />
            </div>
            <h1 className="text-2xl font-bold mb-2">{pick(t.successTitle)}</h1>
            {email && <p className="text-sm text-muted-foreground mb-1">{email}</p>}
            <p className="text-sm text-muted-foreground mb-6">{pick(t.successSub)}</p>
            <Link
              href={`/${locale}/account`}
              className="inline-flex items-center justify-center h-12 px-8 rounded-full bg-[#d4a853] text-white font-semibold hover:bg-[#c29945] transition-colors"
            >
              {pick(t.successCta)}
            </Link>
          </div>
        )}

        {status === 'error' && (
          <div style={{ animation: 'fadeSlideUp 400ms ease-out' }}>
            <div className="h-20 w-20 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-5">
              <AlertCircle className="h-10 w-10 text-amber-500" />
            </div>
            <h1 className="text-2xl font-bold mb-2">{pick(t.errorTitle)}</h1>
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">{pick(t.errorSub)}</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href={`/${locale}/auth/login`}
                className="inline-flex items-center justify-center h-12 px-6 rounded-full bg-[#d4a853] text-white font-semibold hover:bg-[#c29945] transition-colors"
              >
                {pick(t.login)}
              </Link>
              <Link
                href={`/${locale}/auth/reset-password`}
                className="inline-flex items-center justify-center h-12 px-6 rounded-full border-2 border-[#1a1a2e] text-[#1a1a2e] font-semibold hover:bg-muted/40 transition-colors"
              >
                {pick(t.request)}
              </Link>
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
