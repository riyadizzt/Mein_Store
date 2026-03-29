import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface ShopSettings {
  brandName: string
  logoUrl: string
  faviconUrl: string
  accentColor: string
  currency: string
  heroBanner: {
    image: string
    title: { de: string; en: string; ar: string }
    subtitle: { de: string; en: string; ar: string }
    cta: { de: string; en: string; ar: string }
    ctaLink: string
  }
  social: { instagram: string; facebook: string; tiktok: string }
  legal: {
    impressum: { de: string; en: string; ar: string }
    agb: { de: string; en: string; ar: string }
    datenschutz: { de: string; en: string; ar: string }
    widerruf: { de: string; en: string; ar: string }
  }
  contact: { email: string; phone: string; address: string; hours: string }
  stripeEnabled?: boolean
  klarnaEnabled?: boolean
  paypalEnabled?: boolean
}

export function useShopSettings() {
  return useQuery<ShopSettings>({
    queryKey: ['shop-settings-public'],
    queryFn: async () => {
      const { data } = await api.get('/settings/public')
      return data
    },
    staleTime: 5 * 60 * 1000, // 5 min cache
    gcTime: 30 * 60 * 1000,
  })
}
