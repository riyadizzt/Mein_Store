'use client'

import { useState, useRef } from 'react'
import { useLocale } from 'next-intl'
import { Mail, ArrowRight, Check } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(ScrollTrigger)

const COPY = {
  de: { eyebrow: 'Newsletter', heading: '10% auf deine erste Bestellung', body: 'Erhalte exklusive Angebote, neue Kollektionen und Style-Inspiration direkt in dein Postfach.', placeholder: 'Deine E-Mail-Adresse', cta: 'Anmelden', success: 'Willkommen! Dein Gutscheincode kommt per E-Mail.', privacy: 'Kein Spam. Jederzeit abmeldbar.', emailError: 'Bitte gültige E-Mail-Adresse eingeben' },
  en: { eyebrow: 'Newsletter', heading: '10% off your first order', body: 'Get exclusive deals, new collections, and style inspiration delivered to your inbox.', placeholder: 'Your email address', cta: 'Subscribe', success: 'Welcome! Your discount code is on its way.', privacy: 'No spam. Unsubscribe anytime.', emailError: 'Please enter a valid email address' },
  ar: { eyebrow: 'النشرة البريدية', heading: '10% خصم على طلبك الأول', body: 'احصل على عروض حصرية ومجموعات جديدة وإلهام أزياء مباشرة في بريدك.', placeholder: 'بريدك الإلكتروني', cta: 'اشترك', success: 'أهلاً! رمز الخصم في طريقه إليك.', privacy: 'لا بريد مزعج. يمكنك إلغاء الاشتراك في أي وقت.', emailError: 'يرجى إدخال بريد إلكتروني صالح' },
}

export function NewsletterSection() {
  const locale = useLocale() as 'de' | 'en' | 'ar'
  const copy = COPY[locale] ?? COPY.de
  const [email, setEmail] = useState('')
  const [subscribed, setSubscribed] = useState(false)
  const [focused, setFocused] = useState(false)
  const [emailError, setEmailError] = useState('')
  const sectionRef = useRef<HTMLElement>(null)

  useGSAP(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) return
    gsap.from('[data-nl-content]', {
      y: 40, opacity: 0, duration: 0.7, ease: 'power3.out', stagger: 0.1,
      scrollTrigger: { trigger: sectionRef.current, start: 'top 75%', once: true },
    })
  }, { scope: sectionRef })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !email.includes('@')) return
    const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
    fetch(`${API}/api/v1/newsletter/subscribe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), locale }),
    }).catch(() => {})
    setSubscribed(true)
    setEmail('')
  }

  return (
    <section ref={sectionRef} aria-label="Newsletter" className="py-20 sm:py-28 bg-ink text-white overflow-hidden relative">
      {/* Decorative gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-ink via-ink to-[#2a2a3e] opacity-80" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-brand-gold/5 blur-3xl" />

      <div className="relative mx-auto max-w-2xl px-6 sm:px-8 text-center">
        <div data-nl-content className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand-gold/15 text-brand-gold text-xs font-semibold tracking-wider uppercase mb-6">
          <Mail className="h-3.5 w-3.5" />
          {copy.eyebrow}
        </div>

        <h2 data-nl-content className="text-3xl sm:text-4xl md:text-5xl font-display font-bold leading-tight">
          {copy.heading}
        </h2>

        <p data-nl-content className="mt-5 text-white/55 text-lg leading-relaxed">
          {copy.body}
        </p>

        <div data-nl-content className="mt-10">
          <AnimatePresence mode="wait">
            {subscribed ? (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                className="flex items-center justify-center gap-3 text-brand-gold font-medium"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 20, delay: 0.1 }}
                  className="h-8 w-8 rounded-full bg-brand-gold/20 flex items-center justify-center"
                >
                  <Check className="h-4 w-4" />
                </motion.div>
                {copy.success}
              </motion.div>
            ) : (
              <motion.form
                key="form"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onSubmit={handleSubmit}
                className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
              >
                <div className={`relative flex-1 transition-transform duration-300 ${focused ? 'scale-[1.02]' : ''}`}>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); if (emailError) setEmailError('') }}
                    onFocus={() => setFocused(true)}
                    onBlur={() => {
                      setFocused(false)
                      if (email && (!email.includes('@') || !email.includes('.'))) {
                        setEmailError(copy.emailError)
                      } else {
                        setEmailError('')
                      }
                    }}
                    placeholder={copy.placeholder}
                    required
                    aria-invalid={!!emailError}
                    className={`w-full h-13 px-5 rounded-full bg-white/10 border text-white text-sm placeholder:text-white/35 focus:outline-none transition-all duration-300 ${
                      emailError
                        ? 'border-red-400/60 ring-2 ring-red-400/20'
                        : focused
                          ? 'border-brand-gold/50 ring-2 ring-brand-gold/15 bg-white/15'
                          : 'border-white/10'
                    }`}
                  />
                  {emailError && (
                    <p className="absolute -bottom-6 left-0 text-xs text-red-400" role="alert">{emailError}</p>
                  )}
                </div>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  type="submit"
                  aria-label={copy.cta}
                  className="h-13 px-8 rounded-full bg-brand-gold hover:bg-brand-gold-dark text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors shrink-0 focus-visible:ring-2 focus-visible:ring-brand-gold-light focus-visible:ring-offset-2 focus-visible:ring-offset-ink outline-none"
                >
                  {copy.cta}
                  <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                </motion.button>
              </motion.form>
            )}
          </AnimatePresence>
        </div>

        <p data-nl-content className="mt-5 text-[11px] text-white/25">{copy.privacy}</p>
      </div>
    </section>
  )
}
