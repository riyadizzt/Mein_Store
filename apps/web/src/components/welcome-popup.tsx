'use client'

import { useState, useEffect } from 'react'
import { useLocale } from 'next-intl'
import { X, Gift, Mail } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { AnimatedCheckmark } from '@/components/overdrive/animated-checkmark'

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

    const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
    fetch(`${API}/api/v1/settings/public`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.welcomePopupEnabled === 'false' || data?.welcomePopupEnabled === false) return
        setTimeout(() => setShow(true), 5000)
      })
      .catch(() => {
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

  return (
    <AnimatePresence>
      {show && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Modal — spring entrance */}
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            className="fixed z-[101] bottom-0 left-0 right-0 md:bottom-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 w-full md:max-w-md"
          >
            <div className="bg-background rounded-t-3xl md:rounded-3xl overflow-hidden shadow-2xl border">
              {/* Close Button */}
              <button
                onClick={handleClose}
                className="absolute top-4 ltr:right-4 rtl:left-4 z-10 p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              >
                <X className="h-4 w-4 text-white" />
              </button>

              {/* Header */}
              <div className="bg-gradient-to-br from-[#1a1a2e] to-[#2a2a4e] px-6 pt-8 pb-6 text-center">
                <motion.div
                  initial={{ scale: 0, rotate: -15 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.15 }}
                  className="h-16 w-16 mx-auto mb-4 rounded-2xl bg-brand-gold/20 flex items-center justify-center"
                >
                  <Gift className="h-8 w-8 text-brand-gold" />
                </motion.div>
                <motion.h2
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="text-xl font-bold text-white mb-1"
                >
                  {t('Willkommen bei Malak!', 'Welcome to Malak!', '!أهلاً بك في ملك')}
                </motion.h2>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="text-white/60 text-sm"
                >
                  {t('Bekleidung & Schuhe', 'Clothing & Shoes', 'ملابس وأحذية')}
                </motion.p>
              </div>

              {/* Content */}
              <div className="px-6 py-6">
                <AnimatePresence mode="wait">
                  {done ? (
                    <motion.div
                      key="done"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                      className="text-center py-4"
                    >
                      <AnimatedCheckmark size={64} />
                      <h3 className="font-bold text-lg mb-1 mt-3">
                        {t('Geschafft!', 'Done!', '!تم')}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {t(
                          'Dein 10% Gutschein wurde an deine E-Mail gesendet.',
                          'Your 10% coupon has been sent to your email.',
                          'تم إرسال قسيمة 10% إلى بريدك الإلكتروني.',
                        )}
                      </p>
                      <button
                        onClick={handleClose}
                        className="mt-4 px-6 py-2 rounded-xl bg-[#1a1a2e] text-white text-sm font-medium hover:bg-[#2a2a4e] transition-colors btn-press"
                      >
                        {t('Weiter einkaufen', 'Continue shopping', 'متابعة التسوق')}
                      </button>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="form"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ delay: 0.1 }}
                    >
                      <div className="flex items-center gap-3 mb-4 p-3 rounded-xl bg-brand-gold/10 border border-brand-gold/20">
                        <div className="text-2xl font-black text-brand-gold">10%</div>
                        <p className="text-sm">
                          {t(
                            'Rabatt auf deine erste Bestellung! Melde dich für unseren Newsletter an.',
                            'off your first order! Subscribe to our newsletter.',
                            'خصم على طلبك الأول! اشترك في نشرتنا.',
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
                            className="w-full h-12 ltr:pl-10 rtl:pr-10 ltr:pr-3 rtl:pl-3 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold/30 focus:border-brand-gold transition-all"
                          />
                        </div>
                        {error && <p className="text-xs text-red-500">{error}</p>}
                        <motion.button
                          whileTap={{ scale: 0.97 }}
                          onClick={handleSubmit}
                          disabled={loading}
                          className="w-full h-12 rounded-xl bg-brand-gold hover:bg-brand-gold-dark text-white font-bold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {loading ? (
                            <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <>
                              {t('Rabatt sichern', 'Get my discount', 'احصل على الخصم')}
                              <Gift className="h-4 w-4" />
                            </>
                          )}
                        </motion.button>
                      </div>

                      <p className="text-[10px] text-muted-foreground/50 text-center mt-3">
                        {t(
                          'Kein Spam. Du kannst dich jederzeit abmelden.',
                          'No spam. Unsubscribe anytime.',
                          'لا بريد مزعج. يمكنك إلغاء الاشتراك في أي وقت.',
                        )}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
