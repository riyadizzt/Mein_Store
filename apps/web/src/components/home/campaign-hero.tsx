'use client'

import { useState, useEffect } from 'react'
import { useLocale } from 'next-intl'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { motion } from 'motion/react'
import type { Campaign } from '@/hooks/use-campaign'

/* ── Animated Countdown with flip effect ── */
function CountdownUnit({ value, label, delay }: { value: number; label: string; delay: number }) {
  const [prev, setPrev] = useState(value)
  const [flipping, setFlipping] = useState(false)

  useEffect(() => {
    if (value !== prev) {
      setFlipping(true)
      const timer = setTimeout(() => { setPrev(value); setFlipping(false) }, 200)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [value, prev])

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5, ease: 'easeOut' }}
      className="flex flex-col items-center"
    >
      <div className={`relative text-2xl sm:text-4xl font-bold text-white tabular-nums bg-white/10 backdrop-blur-md border border-white/10 rounded-xl px-3 sm:px-4 py-2 sm:py-3 min-w-[56px] sm:min-w-[72px] text-center transition-transform duration-200 ${flipping ? 'scale-95' : 'scale-100'}`}>
        {String(value).padStart(2, '0')}
        {/* Subtle glow on change */}
        {flipping && <div className="absolute inset-0 rounded-xl bg-white/5 animate-ping" style={{ animationDuration: '0.4s', animationIterationCount: '1' }} />}
      </div>
      <span className="text-[10px] sm:text-xs text-white/40 mt-2 uppercase tracking-[0.15em] font-medium">{label}</span>
    </motion.div>
  )
}

function Countdown({ endAt }: { endAt: string }) {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 })
  const locale = useLocale()

  useEffect(() => {
    const calc = () => {
      const diff = Math.max(0, new Date(endAt).getTime() - Date.now())
      setTimeLeft({
        days: Math.floor(diff / 86400000),
        hours: Math.floor((diff % 86400000) / 3600000),
        minutes: Math.floor((diff % 3600000) / 60000),
        seconds: Math.floor((diff % 60000) / 1000),
      })
    }
    calc()
    const interval = setInterval(calc, 1000)
    return () => clearInterval(interval)
  }, [endAt])

  const labels = locale === 'ar'
    ? { d: 'يوم', h: 'ساعة', m: 'دقيقة', s: 'ثانية' }
    : locale === 'en'
      ? { d: 'Days', h: 'Hours', m: 'Min', s: 'Sec' }
      : { d: 'Tage', h: 'Stunden', m: 'Min', s: 'Sek' }

  return (
    <div className="flex items-center gap-2 sm:gap-3 mt-8">
      <CountdownUnit value={timeLeft.days} label={labels.d} delay={0.5} />
      <span className="text-2xl sm:text-3xl text-white/20 font-light mt-[-16px]">:</span>
      <CountdownUnit value={timeLeft.hours} label={labels.h} delay={0.6} />
      <span className="text-2xl sm:text-3xl text-white/20 font-light mt-[-16px]">:</span>
      <CountdownUnit value={timeLeft.minutes} label={labels.m} delay={0.7} />
      <span className="text-2xl sm:text-3xl text-white/20 font-light mt-[-16px]">:</span>
      <CountdownUnit value={timeLeft.seconds} label={labels.s} delay={0.8} />
    </div>
  )
}

/* ── Urgency badge ── */
function UrgencyBadge({ locale }: { locale: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.2, type: 'spring', stiffness: 400, damping: 25 }}
      className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-sm border border-white/10 mb-6"
    >
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
      </span>
      <span className="text-xs font-semibold text-white/80 uppercase tracking-wider">
        {locale === 'ar' ? 'عرض محدود' : locale === 'en' ? 'Limited Time' : 'Zeitlich begrenzt'}
      </span>
    </motion.div>
  )
}

/* ── Premium CTA Button with glow ── */
function GlowCTA({ text, href }: { text: string; href: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.9, duration: 0.5 }}
      className="mt-10"
    >
      <Link href={href}>
        <motion.span
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          className="relative inline-flex items-center gap-3 h-14 sm:h-16 px-10 sm:px-14 bg-white text-ink text-base sm:text-lg font-bold rounded-full shadow-elevated transition-shadow duration-300 hover:shadow-[0_0_40px_rgba(212,168,83,0.3)] group"
        >
          {/* Subtle glow ring */}
          <span className="absolute inset-0 rounded-full bg-gradient-to-r from-[#d4a853]/0 via-[#d4a853]/10 to-[#d4a853]/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <span className="relative">{text}</span>
          <ArrowRight className="relative h-5 w-5 rtl:rotate-180 transition-transform duration-300 group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
        </motion.span>
      </Link>
    </motion.div>
  )
}

/* ── Main Campaign Hero ── */
export function CampaignHero({ campaign, locale }: { campaign: Campaign; locale: string }) {
  const currentLocale = locale as 'de' | 'en' | 'ar'

  const title = campaign[`heroTitle${currentLocale === 'de' ? 'De' : currentLocale === 'en' ? 'En' : 'Ar'}` as keyof Campaign] as string || campaign.heroTitleDe || ''
  const subtitle = campaign[`heroSubtitle${currentLocale === 'de' ? 'De' : currentLocale === 'en' ? 'En' : 'Ar'}` as keyof Campaign] as string || campaign.heroSubtitleDe || ''
  const ctaText = campaign[`heroCta${currentLocale === 'de' ? 'De' : currentLocale === 'en' ? 'En' : 'Ar'}` as keyof Campaign] as string || campaign.heroCtaDe || ''
  const ctaLink = campaign.heroCtaLink || `/${locale}/products`

  return (
    <section className="relative w-full min-h-[80vh] sm:min-h-[85vh] max-h-[900px] overflow-hidden flex items-center">
      {/* Background — Image or Gradient with subtle animation */}
      {campaign.heroImageUrl ? (
        <motion.div
          initial={{ scale: 1.1 }}
          animate={{ scale: 1 }}
          transition={{ duration: 8, ease: 'easeOut' }}
          className="absolute inset-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={campaign.heroImageUrl} alt={title} className="absolute inset-0 w-full h-full object-cover" />
        </motion.div>
      ) : campaign.heroBgColor ? (
        <div className="absolute inset-0" style={{ background: campaign.heroBgColor }} />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-[#1a1a2e] via-[#1a1a2e] to-[#d4a853]/20" />
      )}

      {/* Gradient overlays for depth */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/40 to-transparent rtl:bg-gradient-to-l" />

      {/* Animated ambient particles (subtle) */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(3)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-64 h-64 rounded-full bg-[#d4a853]/[0.04] blur-[80px]"
            animate={{
              x: [0, 30, -20, 0],
              y: [0, -20, 30, 0],
            }}
            transition={{ duration: 12 + i * 4, repeat: Infinity, ease: 'easeInOut' }}
            style={{
              top: `${20 + i * 25}%`,
              left: `${10 + i * 30}%`,
            }}
          />
        ))}
      </div>

      {/* Content */}
      <div className="relative z-10 w-full">
        <div className="mx-auto max-w-[1440px] px-6 sm:px-8 lg:px-12 py-16 sm:py-24">
          <div className="max-w-2xl">
            {/* Urgency Badge */}
            <UrgencyBadge locale={currentLocale} />

            {/* Title — staggered reveal */}
            <motion.h1
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.7, ease: [0.25, 0.1, 0.25, 1] }}
              className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-display font-bold text-white leading-[1.05] tracking-tight"
            >
              {title}
            </motion.h1>

            {/* Subtitle */}
            {subtitle && (
              <motion.p
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.6 }}
                className="mt-5 text-lg sm:text-xl text-white/70 leading-relaxed max-w-xl"
              >
                {subtitle}
              </motion.p>
            )}

            {/* Countdown Timer */}
            {campaign.heroCountdown && <Countdown endAt={campaign.endAt} />}

            {/* CTA Button with glow */}
            {ctaText && (
              <GlowCTA
                text={ctaText}
                href={ctaLink.startsWith('/') ? `/${locale}${ctaLink}` : ctaLink}
              />
            )}
          </div>
        </div>
      </div>

      {/* Bottom gradient fade into content below */}
      <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-background to-transparent" />
    </section>
  )
}
