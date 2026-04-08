'use client'

import { useActiveCampaign } from '@/hooks/use-campaign'
import { HeroSection } from './hero-section'
import { CampaignHero } from './campaign-hero'

// Premium hero available at ./hero-premium.tsx if needed later

export function HeroWithCampaign({ locale }: { locale: string }) {
  const { campaign } = useActiveCampaign()

  if (campaign?.heroBannerEnabled) {
    return <CampaignHero campaign={campaign} locale={locale} />
  }

  return <HeroSection locale={locale} />
}
