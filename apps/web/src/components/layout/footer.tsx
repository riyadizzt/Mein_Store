'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Check, ArrowRight, Instagram, Facebook, Truck, RotateCcw, ShieldCheck, Lock, Cookie } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useConsentStore } from '@/store/consent-store'

/* ── TikTok SVG ── */
const TikTokIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V9.39a8.16 8.16 0 004.76 1.52V7.46a4.85 4.85 0 01-1-.77z" />
  </svg>
)

/* ── Payment Logos (simple pill badges — always visible, always correct) ── */
function PaymentBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="h-8 px-4 rounded-md bg-white/[0.08] border border-white/[0.1] flex items-center justify-center text-white/70 text-[13px] font-bold tracking-tight">
      {children}
    </span>
  )
}

/* ── Footer Link with gold underline hover ── */
function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="relative inline-block text-sm text-white/50 hover:text-white/90 transition-colors duration-200 pb-0.5 group"
      >
        {children}
        <span className="absolute bottom-0 left-0 rtl:left-auto rtl:right-0 w-0 h-px bg-brand-gold transition-all duration-300 group-hover:w-full" />
      </Link>
    </li>
  )
}

/* ── Main Footer Component ── */
export function Footer({ locale }: { locale: string }) {
  const t = useTranslations('footer')
  const tt = useTranslations('trust')
  const tc = useTranslations('common')
  const [email, setEmail] = useState('')
  const [subscribed, setSubscribed] = useState(false)
  const [focused, setFocused] = useState(false)

  const handleNewsletter = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setSubscribed(true)
    setEmail('')
    setTimeout(() => setSubscribed(false), 4000)
  }

  return (
    <footer>
      {/* ═══════════════════════════════════════════════════════
          BEREICH 1 — Trust-Leiste (Lucide Icons, Gold)
          ═══════════════════════════════════════════════════════ */}
      <div className="bg-[#141425]">
        <div className="mx-auto max-w-7xl px-6 sm:px-8 lg:px-12 py-10 sm:py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 sm:gap-12">
            {[
              { Icon: Truck, label: tt('freeShipping') },
              { Icon: RotateCcw, label: tt('returns') },
              { Icon: ShieldCheck, label: tt('gdpr') },
              { Icon: Lock, label: tt('securePayment') },
            ].map(({ Icon, label }, i) => (
              <div key={i} className="flex flex-col items-center text-center gap-3 group">
                <div className="h-11 w-11 rounded-full border border-brand-gold/25 flex items-center justify-center transition-all duration-300 group-hover:border-brand-gold/50 group-hover:bg-brand-gold/5">
                  <Icon className="h-[18px] w-[18px] text-brand-gold" strokeWidth={1.5} />
                </div>
                <span className="text-[13px] text-white/55 leading-tight">{label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-brand-gold/25 to-transparent" />
      </div>

      {/* ═══════════════════════════════════════════════════════
          BEREICH 2 — Newsletter (schmaler, eleganter)
          ═══════════════════════════════════════════════════════ */}
      <div className="bg-[#111120] relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[250px] bg-brand-gold/[0.03] rounded-full blur-[100px]" />

        <div className="relative mx-auto max-w-lg px-6 sm:px-8 py-14 sm:py-16 text-center">
          <h3 className="text-xl sm:text-2xl font-display font-bold text-white leading-tight">
            {t('newsletterTitle')}
          </h3>
          <p className="mt-2.5 text-[13px] text-white/40">
            {t('newsletterSubtitle')}
          </p>

          <div className="mt-7">
            <AnimatePresence mode="wait">
              {subscribed ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center justify-center gap-2 text-brand-gold text-sm font-medium"
                >
                  <Check className="h-4 w-4" />
                  {t('newsletterSuccess')}
                </motion.div>
              ) : (
                <motion.form
                  key="form"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onSubmit={handleNewsletter}
                  className="flex gap-2.5 max-w-sm mx-auto"
                >
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    placeholder={t('newsletterPlaceholder')}
                    required
                    className={`flex-1 h-11 px-4 bg-white/[0.05] border rounded-full text-white text-sm placeholder:text-white/25 focus:outline-none transition-all duration-300 ${
                      focused ? 'border-brand-gold/40 ring-1 ring-brand-gold/15' : 'border-white/[0.07]'
                    }`}
                  />
                  <button
                    type="submit"
                    className="h-11 px-6 rounded-full bg-brand-gold text-white text-sm font-medium flex items-center gap-1.5 hover:bg-brand-gold-dark transition-colors duration-200 btn-press shrink-0"
                  >
                    <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
                  </button>
                </motion.form>
              )}
            </AnimatePresence>
          </div>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-brand-gold/15 to-transparent" />
      </div>

      {/* ═══════════════════════════════════════════════════════
          BEREICH 3 — Links + Brand
          ═══════════════════════════════════════════════════════ */}
      <div className="bg-[#0a0a0a] text-white/60">
        <div className="mx-auto max-w-7xl px-6 sm:px-8 lg:px-12 pt-14 sm:pt-18 pb-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10 lg:gap-16">

            {/* Brand */}
            <div className="col-span-2 md:col-span-1">
              <span className="text-2xl font-display font-bold text-white tracking-[0.3em] logo-shimmer">
                MALAK
              </span>
              <p className="mt-4 text-[13px] text-white/35 leading-relaxed max-w-[200px]">
                {t('tagline')}
              </p>
              <div className="flex gap-2.5 mt-6">
                {[
                  { label: 'Instagram', icon: <Instagram className="h-4 w-4" /> },
                  { label: 'Facebook', icon: <Facebook className="h-4 w-4" /> },
                  { label: 'TikTok', icon: <TikTokIcon /> },
                ].map(({ label, icon }) => (
                  <a
                    key={label}
                    href="#"
                    aria-label={label}
                    className="h-9 w-9 rounded-full border border-white/10 flex items-center justify-center text-white/35 transition-all duration-300 hover:border-brand-gold/40 hover:text-brand-gold"
                  >
                    {icon}
                  </a>
                ))}
              </div>
            </div>

            {/* Shop */}
            <div>
              <h2 className="text-[11px] font-semibold text-brand-gold/80 tracking-[0.2em] uppercase mb-5">{t('shop')}</h2>
              <ul className="space-y-3">
                <FooterLink href={`/${locale}/products`}>{t('allProducts')}</FooterLink>
                <FooterLink href={`/${locale}/products?department=damen`}>{t('women')}</FooterLink>
                <FooterLink href={`/${locale}/products?department=herren`}>{t('men')}</FooterLink>
              </ul>
            </div>

            {/* Customer Service */}
            <div>
              <h2 className="text-[11px] font-semibold text-brand-gold/80 tracking-[0.2em] uppercase mb-5">{t('customerService')}</h2>
              <ul className="space-y-3">
                <FooterLink href={`/${locale}/contact`}>{t('contact')}</FooterLink>
                <FooterLink href={`/${locale}/tracking`}>{t('trackOrder')}</FooterLink>
                <FooterLink href={`/${locale}/legal/widerruf`}>{t('returnsAndWithdrawal')}</FooterLink>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h2 className="text-[11px] font-semibold text-brand-gold/80 tracking-[0.2em] uppercase mb-5">{t('legal')}</h2>
              <ul className="space-y-3">
                <FooterLink href={`/${locale}/legal/impressum`}>{t('imprint')}</FooterLink>
                <FooterLink href={`/${locale}/legal/datenschutz`}>{t('privacy')}</FooterLink>
                <FooterLink href={`/${locale}/legal/agb`}>{t('terms')}</FooterLink>
                <FooterLink href={`/${locale}/legal/widerruf`}>{t('withdrawal')}</FooterLink>
                <li>
                  <button
                    onClick={() => useConsentStore.getState().openSettings()}
                    className="relative inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white/90 transition-colors duration-200 pb-0.5 group"
                  >
                    <Cookie className="h-3.5 w-3.5" />
                    {locale === 'ar' ? 'إعدادات الكوكيز' : locale === 'en' ? 'Cookie Settings' : 'Cookie-Einstellungen'}
                    <span className="absolute bottom-0 left-0 rtl:left-auto rtl:right-0 w-0 h-px bg-brand-gold transition-all duration-300 group-hover:w-full" />
                  </button>
                </li>
              </ul>
            </div>
          </div>

          {/* Divider */}
          <div className="mt-12 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />

          {/* Bottom — Payments + Copyright */}
          <div className="mt-8 flex flex-col items-center gap-5">
            <div className="flex items-center gap-3 flex-wrap justify-center">
              <PaymentBadge>
                <svg viewBox="0 0 48 30" className="h-5 w-auto" aria-label="Mastercard">
                  <circle cx="17" cy="15" r="9" fill="#eb001b" opacity="0.7"/><circle cx="31" cy="15" r="9" fill="#f79e1b" opacity="0.7"/><path d="M24 8a9 9 0 010 14 9 9 0 000-14z" fill="#ff5f00" opacity="0.8"/>
                </svg>
              </PaymentBadge>
              <PaymentBadge>VISA</PaymentBadge>
              <PaymentBadge>PayPal</PaymentBadge>
              <PaymentBadge>Klarna</PaymentBadge>
              <PaymentBadge>
                <span className="flex items-center gap-1">
                  <svg viewBox="0 0 17 20" className="h-4 w-auto" fill="currentColor"><path d="M14.5 10.3c0-2.1 1.7-3.1 1.8-3.2-1-1.5-2.5-1.7-3-1.7-1.3-.1-2.5.8-3.1.8-.7 0-1.7-.7-2.7-.7-1.4 0-2.7.8-3.4 2.1-1.5 2.5-.4 6.3 1.1 8.3.7 1 1.5 2.2 2.6 2.1 1.1 0 1.4-.7 2.7-.7 1.3 0 1.5.7 2.7.7 1.1 0 1.8-1 2.5-2.1.8-1.2 1.1-2.3 1.1-2.4-1.7-.8-2.3-4-.3-5.2zM12 4c.6-.7 1-1.7.9-2.7-1 0-2.1.7-2.7 1.3-.6.6-1 1.5-.9 2.5 1 .1 2.1-.5 2.7-1.1z"/></svg>
                  Pay
                </span>
              </PaymentBadge>
            </div>
            <p className="text-[11px] text-white/25">
              &copy; {new Date().getFullYear()} Malak Bekleidung. {tc('allRightsReserved')}
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}
