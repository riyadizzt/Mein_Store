'use client'

/**
 * LAYOUT A — Editorial Premium
 *
 * Vision: Like Zalando / COS / Arket — bold hero, asymmetric category showcase,
 * editorial breaks, generous breathing room. Gold accents on light background.
 *
 * Sections (top → bottom):
 *  1. Hero (Campaign override aware) — EAGER
 *  2. Trust Signals strip — EAGER
 *  3. Category Showcase — LAZY (below fold)
 *  4. Bestsellers — LAZY
 *  5. Editorial Banner — LAZY
 *  6. New Arrivals — LAZY
 *  7. Newsletter — LAZY
 *
 * All data-fetching components reused as-is — no DB queries duplicated.
 */

import { useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'
import { HeroWithCampaign } from '@/components/home/hero-with-campaign'
import { TrustSignals } from '@/components/layout/trust-signals'

// Below-the-fold: lazy-load to shrink initial JS
const CategoryShowcase = dynamic(
  () => import('@/components/home/category-showcase').then((m) => ({ default: m.CategoryShowcase })),
  { loading: () => <div className="h-[400px]" /> },
)
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

function GoldDivider() {
  return (
    <div className="mx-auto max-w-[1440px] px-6 py-2">
      <div className="mx-auto max-w-xs h-px bg-gradient-to-r from-transparent via-[#d4a853]/40 to-transparent" />
    </div>
  )
}

export function HomeLayoutA({ locale }: { locale: string }) {
  const t = useTranslations('home')

  return (
    <div className="bg-background">
      {/* 1. Hero — full viewport, immersive, campaign-aware */}
      <HeroWithCampaign locale={locale} />

      {/* 2. Trust signals strip — minimal */}
      <div className="py-6 border-y border-border/50">
        <TrustSignals />
      </div>

      {/* 3. Category Showcase — asymmetric grid */}
      <section className="py-24 lg:py-32">
        <CategoryShowcase />
      </section>

      <GoldDivider />

      {/* 4. Bestsellers — horizontal scroll */}
      <section className="py-20 lg:py-28">
        <FeaturedProducts
          title={t('bestsellers')}
          eyebrow={locale === 'ar' ? 'الأكثر مبيعاً' : locale === 'en' ? 'Most Popular' : 'Am beliebtesten'}
          sort="bestseller"
          locale={locale}
        />
      </section>

      {/* 5. Editorial — emotional break */}
      <section className="py-20 lg:py-28">
        <EditorialBanner locale={locale} />
      </section>

      {/* 6. New Arrivals — on paper bg */}
      <section className="py-20 lg:py-28">
        <FeaturedProducts
          title={t('newArrivals')}
          eyebrow={locale === 'ar' ? 'وصل حديثاً' : locale === 'en' ? 'Just Arrived' : 'Neu eingetroffen'}
          sort="newest"
          locale={locale}
          bgClass="bg-paper"
        />
      </section>

      <GoldDivider />

      {/* 7. Newsletter */}
      <section className="py-20 lg:py-28">
        <NewsletterSection />
      </section>
    </div>
  )
}
