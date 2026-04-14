'use client'

/**
 * LAYOUT B — Minimal High-End
 *
 * Vision: Like COS / Arket / Jil Sander — almost no chrome, no hero.
 * 95% white, generous whitespace as luxury signal. Just three sections:
 * Editorial moment → Bestseller → Lookbook teaser → Newsletter.
 *
 * Sections:
 *  1. Minimal text intro (no image hero) — campaign hero override still works
 *  2. Editorial Banner (the visual anchor)
 *  3. Bestsellers
 *  4. Category teaser (sparse, 2 columns)
 *  5. Newsletter
 *
 * No trust signals, no decorative elements, no badges.
 * Campaign system: if active, render CampaignHero at the top.
 */

import Link from 'next/link'
import Image from 'next/image'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { ArrowRight } from 'lucide-react'
import { useActiveCampaign } from '@/hooks/use-campaign'
import { useCategories } from '@/hooks/use-categories'
import { CampaignHero } from '@/components/home/campaign-hero'

// Lazy-load below-fold sections
const FeaturedProducts = dynamic(
  () => import('@/components/home/featured-products').then((m) => ({ default: m.FeaturedProducts })),
  { loading: () => <div className="h-[600px]" /> },
)
const EditorialBanner = dynamic(
  () => import('@/components/home/editorial-banner').then((m) => ({ default: m.EditorialBanner })),
  { loading: () => <div className="h-[500px]" /> },
)
const NewsletterSection = dynamic(
  () => import('@/components/home/newsletter-section').then((m) => ({ default: m.NewsletterSection })),
  { loading: () => <div className="h-[300px]" /> },
)

export function HomeLayoutB({ locale }: { locale: string }) {
  const t = useTranslations('home')
  const { campaign } = useActiveCampaign()
  const { data: categories } = useCategories()

  const tagline =
    locale === 'ar' ? 'الموسم الجديد. القطع الأساسية.' :
    locale === 'en' ? 'New Season. Essentials Refined.' :
    'Neue Saison. Essentielles, neu definiert.'

  const shopLabel =
    locale === 'ar' ? 'تسوّقي الآن' :
    locale === 'en' ? 'Shop the collection' :
    'Kollektion entdecken'

  const allCats = (categories ?? []).slice(0, 2)

  return (
    <div className="bg-white text-[#0f1419]">
      {/* Campaign override always wins */}
      {campaign?.heroBannerEnabled && (
        <CampaignHero campaign={campaign} locale={locale} />
      )}

      {/* 1. Minimal Intro — text only, generous spacing */}
      {!campaign?.heroBannerEnabled && (
        <section className="pt-32 lg:pt-48 pb-24 lg:pb-40">
          <div className="mx-auto max-w-[1440px] px-6 sm:px-12 lg:px-24">
            <div className="max-w-3xl">
              <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#d4a853] mb-8">
                {locale === 'ar' ? 'شتاء ٢٠٢٦' : locale === 'en' ? 'Winter 2026' : 'Winter 2026'}
              </p>
              <h1 className="text-5xl sm:text-6xl lg:text-7xl xl:text-8xl font-light leading-[1.05] tracking-tight mb-10">
                {tagline}
              </h1>
              <Link
                href={`/${locale}/products`}
                className="inline-flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.15em] border-b border-[#0f1419] pb-1.5 hover:border-[#d4a853] hover:text-[#d4a853] transition-colors"
              >
                {shopLabel}
                <ArrowRight className="h-4 w-4 rtl:rotate-180" />
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* 2. Editorial Banner */}
      <section className="py-24 lg:py-40">
        <EditorialBanner locale={locale} />
      </section>

      {/* 3. Bestsellers */}
      <section className="py-24 lg:py-40">
        <FeaturedProducts
          title={t('bestsellers')}
          eyebrow={locale === 'ar' ? 'الأكثر مبيعاً' : locale === 'en' ? 'Most Popular' : 'Am beliebtesten'}
          sort="bestseller"
          locale={locale}
        />
      </section>

      {/* 4. Category Teaser — 2 large tiles only */}
      {allCats.length > 0 && (
        <section className="py-24 lg:py-40">
          <div className="mx-auto max-w-[1440px] px-6 sm:px-12 lg:px-24">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-12">
              {allCats.map((cat: any, index: number) => {
                const name = cat.translations?.find((tr: any) => tr.language === locale)?.name
                  ?? cat.translations?.find((tr: any) => tr.language === 'de')?.name
                  ?? cat.slug
                return (
                  <Link
                    key={cat.id}
                    href={`/${locale}/products?category=${cat.slug}`}
                    className="group relative aspect-[4/5] lg:aspect-[3/4] overflow-hidden bg-[#f2f2f5]"
                  >
                    {cat.imageUrl && (
                      <Image
                        src={cat.imageUrl}
                        alt={name}
                        fill
                        priority={index === 0}
                        sizes="(max-width: 1024px) 100vw, 50vw"
                        className="object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-105"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-8 lg:p-12">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/80 mb-2">
                        {locale === 'ar' ? 'اكتشف' : locale === 'en' ? 'Discover' : 'Entdecken'}
                      </p>
                      <h3 className="text-3xl lg:text-4xl font-light text-white tracking-tight">{name}</h3>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        </section>
      )}

      {/* 5. Newsletter */}
      <section className="py-24 lg:py-40">
        <NewsletterSection />
      </section>
    </div>
  )
}
