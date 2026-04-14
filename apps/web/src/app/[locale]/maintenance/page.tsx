'use client'

import { API_BASE_URL } from '@/lib/env'
import { useState, useEffect } from 'react'
import { useLocale } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { Send, Check, Instagram, Facebook } from 'lucide-react'

export default function MaintenancePage() {
  const locale = useLocale()
  const t = (d: string, a: string) => locale === 'ar' ? a : d

  const { data: settings } = useQuery({
    queryKey: ['maintenance-status'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/v1/maintenance/status`)
      return res.ok ? res.json() : {}
    },
  })

  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 })

  // Track view
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/v1/maintenance/view`, { method: 'POST' }).catch(() => {})
  }, [])

  // Countdown
  useEffect(() => {
    if (settings?.maintenance_countdown_enabled !== 'true' || !settings?.maintenance_countdown_end) return
    const end = new Date(settings.maintenance_countdown_end).getTime()
    const tick = () => {
      const now = Date.now()
      const diff = Math.max(0, end - now)
      setCountdown({
        days: Math.floor(diff / 86400000),
        hours: Math.floor((diff % 86400000) / 3600000),
        minutes: Math.floor((diff % 3600000) / 60000),
        seconds: Math.floor((diff % 60000) / 1000),
      })
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [settings])

  const handleSubmit = async () => {
    if (!email.includes('@')) return
    const res = await fetch(`${API_BASE_URL}/api/v1/maintenance/subscribe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, locale }),
    })
    if (res.ok) setSubmitted(true)
  }

  const title = locale === 'ar' ? (settings?.maintenance_title_ar || 'نعمل على تحسينات') : (settings?.maintenance_title_de || 'Wir arbeiten an Verbesserungen')
  const desc = locale === 'ar' ? (settings?.maintenance_desc_ar || 'متجرنا قيد التحديث. سنعود قريباً!') : (settings?.maintenance_desc_de || 'Unser Shop wird gerade aktualisiert. Wir sind bald zurück!')
  const showCountdown = settings?.maintenance_countdown_enabled === 'true' && settings?.maintenance_countdown_end
  const showEmailCollection = settings?.maintenance_email_collection === 'true'
  const showSocial = settings?.maintenance_social_links !== 'false'
  const bgImage = settings?.maintenance_bg_image

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden" dir={locale === 'ar' ? 'rtl' : 'ltr'}
      style={{ background: bgImage ? `url(${bgImage}) center/cover` : 'linear-gradient(135deg, #1a1a2e 0%, #0d0d1a 100%)' }}>

      {bgImage && <div className="absolute inset-0 bg-black/60" />}

      <div className="relative z-10 text-center px-6 max-w-xl mx-auto" style={{ animation: 'fadeIn 1s ease-out' }}>
        {/* Logo */}
        <div style={{ animation: 'fadeSlide 0.8s ease-out' }}>
          {settings?.logoUrl ? (
            <img src={settings.logoUrl} alt="Malak Bekleidung" className="h-16 mx-auto mb-6" />
          ) : (
            <div className="mx-auto mb-6 w-16 h-16 rounded-full border-2 border-[#d4a853] flex items-center justify-center">
              <span className="text-[#d4a853] text-2xl font-bold font-serif">M</span>
            </div>
          )}
        </div>

        {/* Gold line */}
        <div className="h-px w-24 bg-gradient-to-r from-transparent via-[#d4a853] to-transparent mx-auto mb-8" />

        {/* Title */}
        <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4" style={{ fontFamily: 'Georgia, serif', animation: 'fadeSlide 1s ease-out 0.2s both' }}>
          {title}
        </h1>

        {/* Description */}
        <p className="text-white/60 text-lg mb-10" style={{ animation: 'fadeSlide 1s ease-out 0.4s both' }}>
          {desc}
        </p>

        {/* Countdown */}
        {showCountdown && (
          <div className="flex justify-center gap-4 mb-10" style={{ animation: 'fadeSlide 1s ease-out 0.6s both' }}>
            {[
              { val: countdown.days, label: t('Tage', 'أيام') },
              { val: countdown.hours, label: t('Stunden', 'ساعات') },
              { val: countdown.minutes, label: t('Minuten', 'دقائق') },
              { val: countdown.seconds, label: t('Sekunden', 'ثواني') },
            ].map((item, i) => (
              <div key={i} className="text-center">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white/5 border border-[#d4a853]/30 flex items-center justify-center mb-2">
                  <span className="text-2xl sm:text-3xl font-bold text-[#d4a853] tabular-nums">{String(item.val).padStart(2, '0')}</span>
                </div>
                <span className="text-[10px] text-white/40 uppercase tracking-wider">{item.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Email Collection */}
        {showEmailCollection && !submitted && (
          <div className="max-w-sm mx-auto mb-10" style={{ animation: 'fadeSlide 1s ease-out 0.8s both' }}>
            <p className="text-sm text-white/50 mb-3">{t('Benachrichtige mich wenn der Shop wieder online ist', 'أعلمني عندما يعود المتجر')}</p>
            <div className="flex gap-2">
              <input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder={t('Deine E-Mail-Adresse', 'بريدك الإلكتروني')}
                className="flex-1 h-11 px-4 rounded-xl bg-white/10 border border-white/20 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-[#d4a853]"
              />
              <button onClick={handleSubmit} className="h-11 px-5 rounded-xl bg-[#d4a853] text-black font-medium text-sm hover:bg-[#c49b4a] transition-colors flex items-center gap-1.5">
                <Send className="h-4 w-4" />{t('Senden', 'إرسال')}
              </button>
            </div>
          </div>
        )}
        {submitted && (
          <div className="flex items-center justify-center gap-2 text-[#d4a853] mb-10" style={{ animation: 'fadeSlide 0.5s ease-out' }}>
            <Check className="h-5 w-5" />
            <span className="text-sm">{t('Danke! Wir benachrichtigen dich.', 'شكراً! سنعلمك عند العودة.')}</span>
          </div>
        )}

        {/* Social */}
        {showSocial && (
          <div className="flex justify-center gap-4" style={{ animation: 'fadeSlide 1s ease-out 1s both' }}>
            {settings?.instagramUrl && (
              <a href={settings.instagramUrl} target="_blank" rel="noopener noreferrer"
                className="w-10 h-10 rounded-full border border-[#d4a853]/40 bg-[#d4a853]/10 flex items-center justify-center hover:bg-[#d4a853]/20 transition-colors">
                <Instagram className="h-4 w-4 text-[#d4a853]" />
              </a>
            )}
            {settings?.facebookUrl && (
              <a href={settings.facebookUrl} target="_blank" rel="noopener noreferrer"
                className="w-10 h-10 rounded-full border border-[#d4a853]/40 bg-[#d4a853]/10 flex items-center justify-center hover:bg-[#d4a853]/20 transition-colors">
                <Facebook className="h-4 w-4 text-[#d4a853]" />
              </a>
            )}
            {settings?.tiktokUrl && (
              <a href={settings.tiktokUrl} target="_blank" rel="noopener noreferrer"
                className="w-10 h-10 rounded-full border border-[#d4a853]/40 bg-[#d4a853]/10 flex items-center justify-center hover:bg-[#d4a853]/20 transition-colors">
                <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#d4a853]" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.51a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.98a8.21 8.21 0 004.76 1.52V7.05a4.84 4.84 0 01-1-.36z"/></svg>
              </a>
            )}
          </div>
        )}

        {/* Language toggle */}
        <div className="mt-10">
          <a href={locale === 'ar' ? '/de/maintenance' : '/ar/maintenance'} className="text-xs text-white/30 hover:text-white/50 transition-colors">
            {locale === 'ar' ? 'Deutsch' : 'العربية'}
          </a>
        </div>
      </div>
    </div>
  )
}
