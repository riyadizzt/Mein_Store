'use client'

import { useState, useEffect } from 'react'
import { useLocale } from 'next-intl'
import { X, Gift, Mail, Sparkles } from 'lucide-react'

export function WelcomePopup() {
  const locale = useLocale()
  const t = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d
  const [show, setShow] = useState(false)
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (localStorage.getItem('malak_welcome_shown')) return

    // Check if popup is enabled in admin settings
    const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
    fetch(`${API}/api/v1/settings/public`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.welcomePopupEnabled === 'false' || data?.welcomePopupEnabled === false) return
        setTimeout(() => setShow(true), 5000)
      })
      .catch(() => {
        // If settings endpoint not available, show popup anyway
        setTimeout(() => setShow(true), 5000)
      })
  }, [])

  const handleClose = () => {
    setShow(false)
    localStorage.setItem('malak_welcome_shown', '1')
  }

  const handleSubmit = async () => {
    if (!email.trim() || !email.includes('@')) {
      setError(t('Bitte gib eine gültige E-Mail ein', 'Please enter a valid email', 'يرجى إدخال بريد إلكتروني صالح'))
      return
    }
    setLoading(true)
    setError('')

    try {
      const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
      await fetch(`${API}/api/v1/newsletter/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), locale }),
      })
      setDone(true)
      localStorage.setItem('malak_welcome_shown', '1')
    } catch {
      setError(t('Fehler beim Anmelden', 'Subscription failed', 'فشل الاشتراك'))
    }
    setLoading(false)
  }

  if (!show) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm" onClick={handleClose} style={{ animation: 'fadeIn 300ms ease-out' }} />

      {/* Desktop: Centered Modal / Mobile: Bottom Sheet */}
      <div className={`fixed z-[101] ${
        // Mobile: bottom sheet
        'bottom-0 left-0 right-0 md:bottom-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2'
      } w-full md:max-w-md`}
        style={{ animation: 'slideUp 400ms cubic-bezier(0.16, 1, 0.3, 1)' }}
      >
        <div className="bg-background rounded-t-3xl md:rounded-3xl overflow-hidden shadow-2xl border">
          {/* Close Button */}
          <button onClick={handleClose} className="absolute top-4 ltr:right-4 rtl:left-4 z-10 p-1.5 rounded-full bg-black/10 hover:bg-black/20 transition-colors">
            <X className="h-4 w-4" />
          </button>

          {/* Header with gradient */}
          <div className="bg-gradient-to-br from-[#1a1a2e] to-[#2a2a4e] px-6 pt-8 pb-6 text-center">
            <div className="h-16 w-16 mx-auto mb-4 rounded-2xl bg-[#d4a853]/20 flex items-center justify-center">
              <Gift className="h-8 w-8 text-[#d4a853]" />
            </div>
            <h2 className="text-xl font-bold text-white mb-1">
              {t('Willkommen bei Malak!', 'Welcome to Malak!', '!أهلاً بك في ملك')}
            </h2>
            <p className="text-white/60 text-sm">
              {t('Bekleidung & Schuhe', 'Clothing & Shoes', 'ملابس وأحذية')}
            </p>
          </div>

          {/* Content */}
          <div className="px-6 py-6">
            {done ? (
              <div className="text-center py-4" style={{ animation: 'fadeIn 300ms ease-out' }}>
                <div className="h-14 w-14 mx-auto mb-3 rounded-full bg-green-100 flex items-center justify-center">
                  <Sparkles className="h-6 w-6 text-green-600" />
                </div>
                <h3 className="font-bold text-lg mb-1">{t('Geschafft!', 'Done!', '!تم')}</h3>
                <p className="text-sm text-muted-foreground">
                  {t(
                    'Dein 10% Gutschein wurde an deine E-Mail gesendet.',
                    'Your 10% coupon has been sent to your email.',
                    'تم إرسال قسيمة 10% إلى بريدك الإلكتروني.'
                  )}
                </p>
                <button onClick={handleClose} className="mt-4 px-6 py-2 rounded-xl bg-[#1a1a2e] text-white text-sm font-medium hover:bg-[#2a2a4e] transition-colors">
                  {t('Weiter einkaufen', 'Continue shopping', 'متابعة التسوق')}
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-4 p-3 rounded-xl bg-[#d4a853]/10 border border-[#d4a853]/20">
                  <div className="text-2xl font-black text-[#d4a853]">10%</div>
                  <p className="text-sm">
                    {t(
                      'Rabatt auf deine erste Bestellung! Melde dich für unseren Newsletter an.',
                      'off your first order! Subscribe to our newsletter.',
                      'خصم على طلبك الأول! اشترك في نشرتنا.'
                    )}
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="relative">
                    <Mail className="absolute ltr:left-3 rtl:right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setError('') }}
                      onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                      placeholder={t('Deine E-Mail-Adresse', 'Your email address', 'بريدك الإلكتروني')}
                      className="w-full h-12 ltr:pl-10 rtl:pr-10 ltr:pr-3 rtl:pl-3 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-[#d4a853]/30 focus:border-[#d4a853]"
                    />
                  </div>
                  {error && <p className="text-xs text-red-500">{error}</p>}
                  <button
                    onClick={handleSubmit}
                    disabled={loading}
                    className="w-full h-12 rounded-xl bg-[#d4a853] hover:bg-[#c49843] text-white font-bold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>{t('Rabatt sichern', 'Get my discount', 'احصل على الخصم')} <Gift className="h-4 w-4" /></>
                    )}
                  </button>
                </div>

                <p className="text-[10px] text-muted-foreground/50 text-center mt-3">
                  {t(
                    'Kein Spam. Du kannst dich jederzeit abmelden.',
                    'No spam. Unsubscribe anytime.',
                    'لا بريد مزعج. يمكنك إلغاء الاشتراك في أي وقت.'
                  )}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
