'use client'

import { useLocale } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { MessageCircle } from 'lucide-react'

export function WhatsAppButton() {
  const locale = useLocale()

  const { data } = useQuery({
    queryKey: ['whatsapp-settings'],
    queryFn: async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/v1/settings/public`)
        if (!res.ok) return null
        return res.json()
      } catch { return null }
    },
    staleTime: 60 * 60 * 1000,
  })

  if (!data?.whatsapp_enabled || data.whatsapp_enabled !== 'true') return null
  if (!data?.whatsapp_number) return null

  const number = data.whatsapp_number.replace(/[^0-9]/g, '')
  const message = locale === 'ar' ? (data.whatsapp_message_ar ?? '') : (data.whatsapp_message_de ?? '')
  const url = `https://wa.me/${number}${message ? `?text=${encodeURIComponent(message)}` : ''}`

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-6 ltr:right-6 rtl:left-6 z-40 w-14 h-14 rounded-full bg-[#d4a853] hover:bg-[#c49b4a] shadow-lg hover:shadow-xl flex items-center justify-center transition-all hover:scale-110 group"
      title="WhatsApp"
    >
      <MessageCircle className="h-6 w-6 text-black" />
      {/* Tooltip */}
      <span className="absolute ltr:right-16 rtl:left-16 top-1/2 -translate-y-1/2 bg-background border rounded-xl px-3 py-1.5 text-xs font-medium shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
        {locale === 'ar' ? 'تواصل معنا عبر واتساب' : 'WhatsApp Chat'}
      </span>
    </a>
  )
}

// Product sharing helper
export function getWhatsAppShareUrl(productName: string, price: string, productUrl: string, locale: string) {
  const message = locale === 'ar'
    ? `شاهد هذا: ${productName} — ${price} في ملك بيكلايدونغ: ${productUrl}?utm_source=whatsapp&utm_medium=share`
    : `Schau dir das an: ${productName} — ${price} bei Malak Bekleidung: ${productUrl}?utm_source=whatsapp&utm_medium=share`
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}
