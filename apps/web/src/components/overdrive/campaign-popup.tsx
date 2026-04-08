'use client'

import { useState, useEffect } from 'react'
import { useLocale } from 'next-intl'
import Image from 'next/image'
import { X, Gift } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { useActiveCampaign } from '@/hooks/use-campaign'

const STORAGE_KEY = 'malak-campaign-popup-seen'

export function CampaignPopup() {
  const locale = useLocale() as 'de' | 'en' | 'ar'
  const { campaign } = useActiveCampaign()
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!campaign?.popupEnabled) return undefined

    if (campaign.popupOncePerVisitor) {
      const seen = localStorage.getItem(STORAGE_KEY)
      if (seen === campaign.id) return undefined
    }

    const trigger = campaign.popupTrigger || 'delay_5s'

    if (trigger === 'immediate') {
      setShow(true)
      return undefined
    }

    if (trigger.startsWith('delay_')) {
      const seconds = parseInt(trigger.replace('delay_', '').replace('s', ''), 10) || 5
      const timer = setTimeout(() => setShow(true), seconds * 1000)
      return () => clearTimeout(timer)
    }

    if (trigger === 'exit_intent') {
      const handler = (e: MouseEvent) => {
        if (e.clientY <= 5) { setShow(true); document.removeEventListener('mouseout', handler) }
      }
      document.addEventListener('mouseout', handler)
      return () => document.removeEventListener('mouseout', handler)
    }

    return undefined
  }, [campaign])

  const handleClose = () => {
    setShow(false)
    if (campaign?.popupOncePerVisitor && campaign.id) {
      localStorage.setItem(STORAGE_KEY, campaign.id)
    }
  }

  if (!campaign?.popupEnabled) return null

  const text = campaign[`popupText${locale === 'de' ? 'De' : locale === 'en' ? 'En' : 'Ar'}` as keyof typeof campaign] as string || campaign.popupTextDe || ''

  return (
    <AnimatePresence>
      {show && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm"
            onClick={handleClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            className="fixed z-[151] bottom-0 left-0 right-0 md:bottom-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 w-full md:max-w-md bg-background rounded-t-2xl md:rounded-2xl shadow-2xl border overflow-hidden"
          >
            <button onClick={handleClose} className="absolute top-3 ltr:right-3 rtl:left-3 z-10 p-1.5 rounded-full bg-black/20 hover:bg-black/40 transition-colors">
              <X className="h-4 w-4 text-white" />
            </button>

            {/* Image */}
            {campaign.popupImageUrl && (
              <div className="relative h-48 bg-muted">
                <Image src={campaign.popupImageUrl} alt="" fill className="object-cover" />
              </div>
            )}

            {/* Content */}
            <div className="p-6 text-center">
              {!campaign.popupImageUrl && (
                <div className="h-14 w-14 rounded-2xl bg-brand-gold/15 flex items-center justify-center mx-auto mb-4">
                  <Gift className="h-7 w-7 text-brand-gold" />
                </div>
              )}

              {text && <p className="text-base font-semibold mb-2">{text}</p>}

              {campaign.popupCouponCode && (
                <div className="mt-4 px-4 py-3 bg-brand-gold/10 border border-brand-gold/20 rounded-xl">
                  <p className="text-xs text-muted-foreground mb-1">
                    {locale === 'ar' ? 'رمز الخصم' : locale === 'en' ? 'Discount code' : 'Gutschein-Code'}
                  </p>
                  <p className="text-xl font-bold font-mono text-brand-gold tracking-wider">{campaign.popupCouponCode}</p>
                </div>
              )}

              <button
                onClick={handleClose}
                className="mt-5 w-full h-11 rounded-xl bg-foreground text-background text-sm font-semibold btn-press transition-colors hover:bg-foreground/90"
              >
                {locale === 'ar' ? 'تسوق الآن' : locale === 'en' ? 'Shop now' : 'Jetzt shoppen'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
