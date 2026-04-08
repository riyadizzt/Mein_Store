'use client'

import { useActiveCampaign } from '@/hooks/use-campaign'
import { HeroPremium } from './hero-premium'
import { CampaignHero } from './campaign-hero'

// Old hero backup: ./hero-section-backup.tsx
// To revert: import { HeroSection } from './hero-section-backup' and replace HeroPremium below

export function HeroWithCampaign({ locale }: { locale: string }) {
  const { campaign } = useActiveCampaign()

  if (campaign?.heroBannerEnabled) {
    return <CampaignHero campaign={campaign} locale={locale} />
  }

  return <HeroPremium locale={locale} />
}
