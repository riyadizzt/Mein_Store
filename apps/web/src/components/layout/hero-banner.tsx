'use client'

import { useTranslations, useLocale } from 'next-intl'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useShopSettings } from '@/hooks/use-shop-settings'

const DEFAULT_HERO = 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&q=75&auto=format&fit=crop'

export function HeroBanner({ locale }: { locale: string }) {
  const t = useTranslations('home')
  const currentLocale = useLocale() as 'de' | 'en' | 'ar'
  const { data: settings } = useShopSettings()

  const heroImage = settings?.heroBanner?.image || DEFAULT_HERO
  const title = settings?.heroBanner?.title?.[currentLocale] || t('welcome')
  const subtitle = settings?.heroBanner?.subtitle?.[currentLocale] || t('subtitle')
  const cta = settings?.heroBanner?.cta?.[currentLocale] || t('cta')
  const ctaLink = settings?.heroBanner?.ctaLink || `/${locale}/products`

  return (
    <section className="relative w-full h-[70vh] max-h-[700px] min-h-[500px] overflow-hidden">
      <Image
        src={heroImage}
        alt={title}
        fill
        priority
        sizes="100vw"
        className="object-cover scale-105"
      />

      <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />

      <div className="relative z-10 h-full flex items-center">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 w-full">
          <div className="max-w-xl animate-fade-in">
            <div className="h-1 w-16 bg-accent mb-6 rounded-full" />

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-[1.1]">
              {title}
            </h1>

            <p className="mt-5 text-lg sm:text-xl text-white/80 leading-relaxed">
              {subtitle}
            </p>

            <div className="mt-8">
              <Link href={ctaLink.startsWith('/') ? `/${locale}${ctaLink}` : ctaLink}>
                <Button size="lg" className="h-14 px-10 text-base font-semibold gap-2 bg-white text-foreground hover:bg-white/90 shadow-elevated transition-all duration-300 hover:shadow-xl hover:scale-[1.02]">
                  {cta}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
