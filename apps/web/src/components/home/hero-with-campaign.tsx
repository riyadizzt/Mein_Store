'use client'

import { useActiveCampaign } from '@/hooks/use-campaign'
import { HeroSection } from './hero-section'
import { CampaignHero } from './campaign-hero'

/**
 * Hero wrapper — shows Campaign Hero if active campaign exists,
 * otherwise falls back to the default HeroSection.
 */
export function HeroWithCampaign({ locale }: { locale: string }) {
  const { campaign } = useActiveCampaign()

  if (campaign?.heroBannerEnabled) {
    return <CampaignHero campaign={campaign} locale={locale} />
  }

  return <HeroSection locale={locale} />
}
