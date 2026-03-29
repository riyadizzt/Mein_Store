'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { CreditCard, Shield, Truck, RotateCcw, Mail, ArrowRight, Instagram, Facebook } from 'lucide-react'

export function Footer({ locale }: { locale: string }) {
  const t = useTranslations('footer')
  const tt = useTranslations('trust')
  const tc = useTranslations('common')
  const [email, setEmail] = useState('')
  const [subscribed, setSubscribed] = useState(false)

  const handleNewsletter = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setSubscribed(true)
    setEmail('')
    setTimeout(() => setSubscribed(false), 4000)
  }

  return (
    <footer className="bg-[#0a0a0a] text-white/80">
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
              <div key={i} className="flex flex-col items-center gap-2.5 group">
                <div className="h-12 w-12 rounded-full bg-white/5 flex items-center justify-center transition-all duration-300 group-hover:bg-white/10 group-hover:scale-110">
                  <Icon className="h-5 w-5 text-accent" />
                </div>
                <span className="text-xs font-medium">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Newsletter */}
      <div className="border-b border-white/10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
          <div className="max-w-xl mx-auto text-center">
            <Mail className="h-8 w-8 mx-auto mb-4 text-accent" />
            <h3 className="text-lg font-bold text-white mb-2">{t('newsletterTitle')}</h3>
            <p className="text-sm text-white/60 mb-6">{t('newsletterSubtitle')}</p>
            {subscribed ? (
              <p className="text-sm text-accent font-medium animate-fade-up">{t('newsletterSuccess')}</p>
            ) : (
              <form onSubmit={handleNewsletter} className="flex gap-2 max-w-md mx-auto">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('newsletterPlaceholder')}
                  className="flex-1 h-11 px-4 rounded-xl bg-white/10 border border-white/10 text-white text-sm placeholder:text-white/40 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                  required
                />
                <button type="submit" className="h-11 px-6 rounded-xl bg-accent text-white font-medium text-sm flex items-center gap-2 hover:bg-accent/90 transition-all duration-200 btn-press">
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Main Footer */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <span className="text-xl font-bold text-white tracking-[0.2em]">MALAK</span>
            <p className="mt-3 text-sm text-white/50 leading-relaxed">{t('tagline')}</p>
            {/* Social */}
            <div className="flex gap-3 mt-5">
              <a href="#" className="h-9 w-9 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/15 transition-all duration-200 hover:scale-110">
                <Instagram className="h-4 w-4" />
              </a>
              <a href="#" className="h-9 w-9 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/15 transition-all duration-200 hover:scale-110">
                <Facebook className="h-4 w-4" />
              </a>
              <a href="#" className="h-9 w-9 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/15 transition-all duration-200 hover:scale-110">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V9.39a8.16 8.16 0 004.76 1.52V7.46a4.85 4.85 0 01-1-.77z"/></svg>
              </a>
            </div>
          </div>

          {/* Shop */}
          <div>
            <h2 className="text-sm font-semibold text-white mb-4">{t('shop')}</h2>
            <ul className="space-y-2.5">
              <li><Link href={`/${locale}/products`} className="text-sm hover:text-white transition-colors duration-200">{t('allProducts')}</Link></li>
              <li><Link href={`/${locale}/products?department=damen`} className="text-sm hover:text-white transition-colors duration-200">{t('women')}</Link></li>
              <li><Link href={`/${locale}/products?department=herren`} className="text-sm hover:text-white transition-colors duration-200">{t('men')}</Link></li>
            </ul>
          </div>

          {/* Customer Service */}
          <div>
            <h2 className="text-sm font-semibold text-white mb-4">{t('customerService')}</h2>
            <ul className="space-y-2.5">
              <li><Link href={`/${locale}/contact`} className="text-sm hover:text-white transition-colors duration-200">{t('contact')}</Link></li>
              <li><Link href={`/${locale}/tracking`} className="text-sm hover:text-white transition-colors duration-200">{t('trackOrder')}</Link></li>
              <li><Link href={`/${locale}/legal/widerruf`} className="text-sm hover:text-white transition-colors duration-200">{t('returnsAndWithdrawal')}</Link></li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h2 className="text-sm font-semibold text-white mb-4">{t('legal')}</h2>
            <ul className="space-y-2.5">
              <li><Link href={`/${locale}/legal/impressum`} className="text-sm hover:text-white transition-colors duration-200">{t('imprint')}</Link></li>
              <li><Link href={`/${locale}/legal/datenschutz`} className="text-sm hover:text-white transition-colors duration-200">{t('privacy')}</Link></li>
              <li><Link href={`/${locale}/legal/agb`} className="text-sm hover:text-white transition-colors duration-200">{t('terms')}</Link></li>
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
            {['Visa', 'Mastercard', 'Klarna', 'PayPal', 'Apple Pay'].map((m) => (
              <span key={m} className="px-3 py-1.5 border border-white/15 rounded-lg text-[11px] font-medium text-white/60 hover:border-white/30 hover:text-white/80 transition-all duration-200">
                {m}
              </span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}
