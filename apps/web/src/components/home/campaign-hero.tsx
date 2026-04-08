'use client'

import { useState, useEffect } from 'react'
import { useLocale } from 'next-intl'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight } from 'lucide-react'
import type { Campaign } from '@/hooks/use-campaign'

/** Countdown Timer */
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
      ? { d: 'Days', h: 'Hrs', m: 'Min', s: 'Sec' }
      : { d: 'Tage', h: 'Std', m: 'Min', s: 'Sek' }

  return (
    <div className="flex items-center gap-3 mt-6">
      {[
        { value: timeLeft.days, label: labels.d },
        { value: timeLeft.hours, label: labels.h },
        { value: timeLeft.minutes, label: labels.m },
        { value: timeLeft.seconds, label: labels.s },
      ].map((unit, i) => (
        <div key={i} className="flex flex-col items-center">
          <span className="text-2xl sm:text-3xl font-bold text-white tabular-nums bg-white/10 backdrop-blur-sm rounded-lg px-3 py-1.5 min-w-[52px] text-center">
            {String(unit.value).padStart(2, '0')}
          </span>
          <span className="text-[10px] text-white/50 mt-1 uppercase tracking-wider">{unit.label}</span>
        </div>
      ))}
    </div>
  )
}

/** Campaign Hero Banner — replaces homepage hero when a campaign is active */
export function CampaignHero({ campaign, locale }: { campaign: Campaign; locale: string }) {
  const currentLocale = locale as 'de' | 'en' | 'ar'

  const title = campaign[`heroTitle${currentLocale === 'de' ? 'De' : currentLocale === 'en' ? 'En' : 'Ar'}` as keyof Campaign] as string || campaign.heroTitleDe || ''
  const subtitle = campaign[`heroSubtitle${currentLocale === 'de' ? 'De' : currentLocale === 'en' ? 'En' : 'Ar'}` as keyof Campaign] as string || campaign.heroSubtitleDe || ''
  const ctaText = campaign[`heroCta${currentLocale === 'de' ? 'De' : currentLocale === 'en' ? 'En' : 'Ar'}` as keyof Campaign] as string || campaign.heroCtaDe || ''
  const ctaLink = campaign.heroCtaLink || `/${locale}/products`

  return (
    <section className="relative w-full min-h-[70vh] max-h-[800px] overflow-hidden flex items-center">
      {/* Background — Image or Gradient */}
      {campaign.heroImageUrl ? (
        <Image src={campaign.heroImageUrl} alt={title} fill priority sizes="100vw" className="object-cover" />
      ) : campaign.heroBgColor ? (
        <div className="absolute inset-0" style={{ background: campaign.heroBgColor }} />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-[#1a1a2e] via-[#1a1a2e] to-[#d4a853]/20" />
      )}

      {/* Dark overlay for text readability */}
      <div className="absolute inset-0 bg-black/30" />

      {/* Content */}
      <div className="relative z-10 w-full">
        <div className="mx-auto max-w-7xl px-6 sm:px-8 lg:px-12 py-16 sm:py-24">
          <div className="max-w-2xl">
            {/* Title */}
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-display font-bold text-white leading-[1.05] tracking-tight animate-fade-up">
              {title}
            </h1>

            {/* Subtitle */}
            {subtitle && (
              <p className="mt-5 text-lg sm:text-xl text-white/75 leading-relaxed animate-fade-up delay-100">
                {subtitle}
              </p>
            )}

            {/* Countdown Timer */}
            {campaign.heroCountdown && (
              <Countdown endAt={campaign.endAt} />
            )}

            {/* CTA Button */}
            {ctaText && (
              <div className="mt-8 animate-fade-up delay-200">
                <Link href={ctaLink.startsWith('/') ? `/${locale}${ctaLink}` : ctaLink}>
                  <span className="inline-flex items-center gap-3 h-14 px-10 bg-white text-ink text-base font-semibold rounded-full shadow-elevated transition-all duration-300 hover:shadow-xl hover:scale-[1.02] btn-press">
                    {ctaText}
                    <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                  </span>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
