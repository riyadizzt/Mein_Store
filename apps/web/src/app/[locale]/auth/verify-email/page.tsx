'use client'

import { useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'

export default function VerifyEmailPage() {
  const locale = useLocale()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [email, setEmail] = useState('')

  useEffect(() => {
    if (!token) { setStatus('error'); return }

    api.get(`/auth/verify-email?token=${token}`)
      .then(({ data }) => {
        setEmail(data?.email ?? '')
        setStatus('success')
      })
      .catch(() => setStatus('error'))
  }, [token])

  const msg = {
    loading: {
      de: 'E-Mail wird verifiziert...',
      en: 'Verifying email...',
      ar: 'جارٍ التحقق من البريد الإلكتروني...',
    },
    success: {
      de: 'E-Mail erfolgreich bestätigt!',
      en: 'Email verified successfully!',
      ar: 'تم التحقق من البريد الإلكتروني بنجاح!',
    },
    error: {
      de: 'Verifizierungslink ungültig oder abgelaufen.',
      en: 'Verification link invalid or expired.',
      ar: 'رابط التحقق غير صالح أو منتهي الصلاحية.',
    },
  }

  const sub = {
    success: {
      de: 'Sie können jetzt alle Funktionen nutzen.',
      en: 'You can now use all features.',
      ar: 'يمكنك الآن استخدام جميع الميزات.',
    },
    error: {
      de: 'Bitte fordern Sie einen neuen Link an.',
      en: 'Please request a new verification link.',
      ar: 'يرجى طلب رابط تحقق جديد.',
    },
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center py-12">
      <div className="w-full max-w-sm px-4 text-center">
        {status === 'loading' && (
          <div style={{ animation: 'fadeIn 300ms ease-out' }}>
            <Loader2 className="h-12 w-12 mx-auto mb-4 text-primary animate-spin" />
            <h1 className="text-xl font-bold">{msg.loading[locale as keyof typeof msg.loading] ?? msg.loading.de}</h1>
          </div>
        )}

        {status === 'success' && (
          <div style={{ animation: 'fadeSlideUp 400ms ease-out' }}>
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <h1 className="text-xl font-bold mb-2">{msg.success[locale as keyof typeof msg.success] ?? msg.success.de}</h1>
            {email && <p className="text-sm text-muted-foreground mb-1">{email}</p>}
            <p className="text-sm text-muted-foreground mb-6">{sub.success[locale as keyof typeof sub.success] ?? sub.success.de}</p>
            <Link
              href={`/${locale}/account`}
              className="inline-flex items-center justify-center h-11 px-6 rounded-xl bg-accent text-accent-foreground font-semibold hover:bg-accent/90 transition-colors"
            >
              {locale === 'ar' ? 'الذهاب إلى حسابي' : locale === 'en' ? 'Go to my account' : 'Zu meinem Konto'}
            </Link>
          </div>
        )}

        {status === 'error' && (
          <div style={{ animation: 'fadeSlideUp 400ms ease-out' }}>
            <div className="h-16 w-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <XCircle className="h-8 w-8 text-red-600" />
            </div>
            <h1 className="text-xl font-bold mb-2">{msg.error[locale as keyof typeof msg.error] ?? msg.error.de}</h1>
            <p className="text-sm text-muted-foreground mb-6">{sub.error[locale as keyof typeof sub.error] ?? sub.error.de}</p>
            <Link
              href={`/${locale}/auth/login`}
              className="inline-flex items-center justify-center h-11 px-6 rounded-xl bg-accent text-accent-foreground font-semibold hover:bg-accent/90 transition-colors"
            >
              {locale === 'ar' ? 'تسجيل الدخول' : locale === 'en' ? 'Sign in' : 'Anmelden'}
            </Link>
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
