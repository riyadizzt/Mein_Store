'use client'

import { useLocale } from 'next-intl'
import Link from 'next/link'
import type { Campaign } from '@/hooks/use-campaign'

/**
 * Campaign Announcement Bar — replaces the default announcement bar
 * when a campaign with announcementEnabled is active.
 */
export function CampaignAnnouncement({ campaign }: { campaign: Campaign }) {
  const locale = useLocale() as 'de' | 'en' | 'ar'

  if (!campaign.announcementEnabled) return null

  const text = campaign[`announcementText${locale === 'de' ? 'De' : locale === 'en' ? 'En' : 'Ar'}` as keyof Campaign] as string
    || campaign.announcementTextDe || ''

  if (!text) return null

  const bgColor = campaign.announcementBgColor || '#d4a853'
  const textColor = campaign.announcementTextColor || '#ffffff'
  const link = campaign.announcementLink

  const content = (
    <div
      className="h-9 flex items-center justify-center text-xs font-medium tracking-wide"
      style={{ backgroundColor: bgColor, color: textColor }}
    >
      <span>{text}</span>
    </div>
  )

  if (link) {
    return <Link href={link}>{content}</Link>
  }

  return content
}
