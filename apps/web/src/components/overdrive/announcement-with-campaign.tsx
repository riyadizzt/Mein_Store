'use client'

import { useActiveCampaign } from '@/hooks/use-campaign'
import { AnnouncementBar } from './announcement-bar'
import { CampaignAnnouncement } from './campaign-announcement'

/**
 * Shows campaign announcement if active, otherwise default announcement bar.
 */
export function AnnouncementWithCampaign() {
  const { campaign } = useActiveCampaign()

  if (campaign?.announcementEnabled) {
    return <CampaignAnnouncement campaign={campaign} />
  }

  return <AnnouncementBar />
}
