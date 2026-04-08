'use client'

import { useQuery } from '@tanstack/react-query'

export interface Campaign {
  id: string
  name: string
  slug: string
  type: string
  status: string
  template: string | null
  startAt: string
  endAt: string
  heroBannerEnabled: boolean
  heroImageUrl: string | null
  heroBgColor: string | null
  heroTitleDe: string | null
  heroTitleEn: string | null
  heroTitleAr: string | null
  heroSubtitleDe: string | null
  heroSubtitleEn: string | null
  heroSubtitleAr: string | null
  heroCtaDe: string | null
  heroCtaEn: string | null
  heroCtaAr: string | null
  heroCtaLink: string | null
  heroCountdown: boolean
  heroAnimation: string | null
  announcementEnabled: boolean
  announcementTextDe: string | null
  announcementTextEn: string | null
  announcementTextAr: string | null
  announcementBgColor: string | null
  announcementTextColor: string | null
  announcementLink: string | null
  popupEnabled: boolean
  popupImageUrl: string | null
  popupTextDe: string | null
  popupTextEn: string | null
  popupTextAr: string | null
  popupCouponCode: string | null
  popupTrigger: string
  popupOncePerVisitor: boolean
  saleBadgeEnabled: boolean
  saleBadgeColor: string
}

/**
 * Fetches the currently active campaign from public API.
 * Returns null if no campaign is active.
 * Refreshes every 60 seconds.
 */
export function useActiveCampaign() {
  const { data, isLoading } = useQuery<Campaign | null>({
    queryKey: ['active-campaign'],
    queryFn: async () => {
      const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
      const res = await fetch(`${API}/api/v1/campaigns/active`)
      if (!res.ok) return null
      const data = await res.json()
      return data ?? null
    },
    staleTime: 60000,
    refetchInterval: 60000,
  })

  return { campaign: data ?? null, isLoading }
}
