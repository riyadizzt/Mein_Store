'use client'

import { useState, useRef } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { CreditCard, Shield, Truck, RotateCcw, Mail, Instagram, Facebook, Check, Send } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'

export function Footer({ locale }: { locale: string }) {
  const t = useTranslations('footer')
  const tt = useTranslations('trust')
  const tc = useTranslations('common')
  const [email, setEmail] = useState('')
  const [subscribed, setSubscribed] = useState(false)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleNewsletter = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setSubscribed(true)
    setEmail('')
    setTimeout(() => setSubscribed(false), 4000)
  }

  return (
    <footer className="bg-slate-950 text-white/80">
      {/* Trust Signals Bar */}
      <div className="border-b border-white/10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { Icon: Truck, label: tt('freeShipping') },
              { Icon: RotateCcw, label: tt('returns') },
              { Icon: Shield, label: tt('gdpr') },
              { Icon: CreditCard, label: tt('securePayment') },
            ].map(({ Icon, label }, i) => (
              <motion.div
                key={i}
                whileHover={{ y: -2 }}
                className="flex flex-col items-center gap-2.5 group"
              >
                <div className="h-12 w-12 rounded-full bg-white/5 flex items-center justify-center transition-all duration-300 group-hover:bg-white/10 group-hover:scale-110">
                  <Icon className="h-5 w-5 text-accent" />
                </div>
                <span className="text-xs font-medium">{label}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* Newsletter — animated input + success */}
      <div className="border-b border-white/10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
          <div className="max-w-xl mx-auto text-center">
            <motion.div
              animate={{ y: focused ? -2 : 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              <Mail className="h-8 w-8 mx-auto mb-4 text-accent" />
            </motion.div>
            <h3 className="text-lg font-bold text-white mb-2">
              {t('newsletterTitle')}
            </h3>
            <p className="text-sm text-white/60 mb-6">
              {t('newsletterSubtitle')}
            </p>

            <AnimatePresence mode="wait">
              {subscribed ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.9, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  className="flex items-center justify-center gap-2 text-sm text-accent font-medium"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 20, delay: 0.1 }}
                  >
                    <Check className="h-5 w-5" />
                  </motion.div>
                  {t('newsletterSuccess')}
                </motion.div>
              ) : (
                <motion.form
                  key="form"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onSubmit={handleNewsletter}
                  className="flex gap-2 max-w-md mx-auto"
                >
                  <div className={`relative flex-1 transition-all duration-300 ${focused ? 'scale-[1.02]' : ''}`}>
                    <input
                      ref={inputRef}
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onFocus={() => setFocused(true)}
                      onBlur={() => setFocused(false)}
                      placeholder={t('newsletterPlaceholder')}
                      className={`w-full h-11 px-4 rounded-xl bg-white/10 border text-white text-sm placeholder:text-white/40 focus:outline-none transition-all duration-300 ${
                        focused
                          ? 'border-accent/60 ring-2 ring-accent/20 bg-white/15'
                          : 'border-white/10'
                      }`}
                      required
                    />
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.93 }}
                    whileHover={{ scale: 1.05 }}
                    type="submit"
                    className="h-11 px-6 rounded-xl bg-accent text-white font-medium text-sm flex items-center gap-2 hover:bg-accent/90 transition-colors duration-200"
                  >
                    <Send className="h-4 w-4" />
                  </motion.button>
                </motion.form>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Main Footer */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <span className="text-xl font-bold text-white tracking-[0.2em] logo-shimmer">
              MALAK
            </span>
            <p className="mt-3 text-sm text-white/50 leading-relaxed">
              {t('tagline')}
            </p>
            {/* Social — enhanced hover */}
            <div className="flex gap-3 mt-5">
              {[
                { label: 'Instagram', icon: <Instagram className="h-4 w-4" />, color: 'hover:bg-gradient-to-br hover:from-purple-500 hover:to-pink-500' },
                { label: 'Facebook', icon: <Facebook className="h-4 w-4" />, color: 'hover:bg-blue-600' },
                { label: 'TikTok', icon: (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V9.39a8.16 8.16 0 004.76 1.52V7.46a4.85 4.85 0 01-1-.77z" />
                  </svg>
                ), color: 'hover:bg-black hover:ring-1 hover:ring-white/20' },
              ].map(({ label, icon, color }) => (
                <motion.a
                  key={label}
                  href="#"
                  aria-label={label}
                  whileHover={{ scale: 1.15, y: -2 }}
                  whileTap={{ scale: 0.95 }}
                  className={`h-11 w-11 rounded-full bg-white/5 flex items-center justify-center transition-all duration-300 hover:text-white ${color}`}
                >
                  {icon}
                </motion.a>
              ))}
            </div>
          </div>

          {/* Shop */}
          <div>
            <h2 className="text-sm font-semibold text-white mb-4">
              {t('shop')}
            </h2>
            <ul className="space-y-2.5">
              <li>
                <Link href={`/${locale}/products`} className="text-sm hover:text-white transition-colors duration-200">
                  {t('allProducts')}
                </Link>
              </li>
              <li>
                <Link href={`/${locale}/products?department=damen`} className="text-sm hover:text-white transition-colors duration-200">
                  {t('women')}
                </Link>
              </li>
              <li>
                <Link href={`/${locale}/products?department=herren`} className="text-sm hover:text-white transition-colors duration-200">
                  {t('men')}
                </Link>
              </li>
            </ul>
          </div>

          {/* Customer Service */}
          <div>
            <h2 className="text-sm font-semibold text-white mb-4">
              {t('customerService')}
            </h2>
            <ul className="space-y-2.5">
              <li>
                <Link href={`/${locale}/contact`} className="text-sm hover:text-white transition-colors duration-200">
                  {t('contact')}
                </Link>
              </li>
              <li>
                <Link href={`/${locale}/tracking`} className="text-sm hover:text-white transition-colors duration-200">
                  {t('trackOrder')}
                </Link>
              </li>
              <li>
                <Link href={`/${locale}/legal/widerruf`} className="text-sm hover:text-white transition-colors duration-200">
                  {t('returnsAndWithdrawal')}
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h2 className="text-sm font-semibold text-white mb-4">
              {t('legal')}
            </h2>
            <ul className="space-y-2.5">
              <li>
                <Link href={`/${locale}/legal/impressum`} className="text-sm hover:text-white transition-colors duration-200">
                  {t('imprint')}
                </Link>
              </li>
              <li>
                <Link href={`/${locale}/legal/datenschutz`} className="text-sm hover:text-white transition-colors duration-200">
                  {t('privacy')}
                </Link>
              </li>
              <li>
                <Link href={`/${locale}/legal/agb`} className="text-sm hover:text-white transition-colors duration-200">
                  {t('terms')}
                </Link>
              </li>
              <li>
                <Link href={`/${locale}/legal/widerruf`} className="text-sm hover:text-white transition-colors duration-200">
                  {t('withdrawal')}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Separator */}
        <div className="mt-12 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        {/* Copyright + Payment */}
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-6">
          <p className="text-xs text-white/50">
            &copy; {new Date().getFullYear()} Malak. {tc('allRightsReserved')}
          </p>
          <div className="flex items-center gap-2">
            {['Visa', 'Mastercard', 'Klarna', 'PayPal', 'Apple Pay'].map(
              (m) => (
                <span
                  key={m}
                  className="px-3 py-1.5 border border-white/15 rounded-lg text-[11px] font-medium text-white/60 hover:border-white/30 hover:text-white/80 transition-all duration-200"
                >
                  {m}
                </span>
              ),
            )}
          </div>
        </div>
      </div>
    </footer>
  )
}
