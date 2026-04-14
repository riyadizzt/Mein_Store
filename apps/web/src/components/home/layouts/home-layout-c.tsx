'use client'

/**
 * LAYOUT C — Dark Luxury
 *
 * Vision: Like Saint Laurent / Rains / Acne Studios — full dark mode,
 * gold accents, products float on dark background. Compact, intense, premium.
 *
 * Sections:
 *  1. Dark Hero (campaign-aware — falls back to dark image hero)
 *  2. Bestsellers (on dark background)
 *  3. Editorial split (image left, text right)
 *  4. New Arrivals (on dark background)
 *  5. Newsletter (dark)
 *
 * NOTE: the page layout/header/footer remain unchanged.
 * Dark styling is applied via wrapper + dark variant of FeaturedProducts.
 */

import Link from 'next/link'
import Image from 'next/image'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { ArrowRight } from 'lucide-react'
import { useActiveCampaign } from '@/hooks/use-campaign'
import { useShopSettings } from '@/hooks/use-shop-settings'
import { CampaignHero } from '@/components/home/campaign-hero'

// Lazy-load below-fold sections
const FeaturedProducts = dynamic(
  () => import('@/components/home/featured-products').then((m) => ({ default: m.FeaturedProducts })),
  { loading: () => <div className="h-[600px]" /> },
)
const NewsletterSection = dynamic(
  () => import('@/components/home/newsletter-section').then((m) => ({ default: m.NewsletterSection })),
  { loading: () => <div className="h-[300px]" /> },
)

export function HomeLayoutC({ locale }: { locale: string }) {
  const t = useTranslations('home')
  const { campaign } = useActiveCampaign()
  const { data: settings } = useShopSettings()

  const title =
    settings?.heroBanner?.title?.[locale as 'de' | 'en' | 'ar'] ||
    (locale === 'ar' ? 'فخامة بلا حدود' : locale === 'en' ? 'Quiet Luxury' : 'Quiet Luxury')

  const subtitle =
    settings?.heroBanner?.subtitle?.[locale as 'de' | 'en' | 'ar'] ||
    (locale === 'ar' ? 'الموسم الجديد متوفر الآن' : locale === 'en' ? 'New season now available' : 'Neue Saison jetzt verfügbar')

  const cta =
    settings?.heroBanner?.cta?.[locale as 'de' | 'en' | 'ar'] ||
    (locale === 'ar' ? 'تسوّقي الآن' : locale === 'en' ? 'Shop now' : 'Jetzt entdecken')

  const heroImage = settings?.heroBanner?.image || 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=2400&q=85'
  const ctaLink = settings?.heroBanner?.ctaLink || `/${locale}/products`

  return (
    <div className="bg-[#0a0a14] text-white">
      {/* Campaign override always wins */}
      {campaign?.heroBannerEnabled ? (
        <CampaignHero campaign={campaign} locale={locale} />
      ) : (
        /* 1. Dark Hero */
        <section className="relative min-h-[92vh] flex items-end overflow-hidden">
          {/* Background image */}
          <div className="absolute inset-0">
            <Image
              src={heroImage}
              alt={title}
              fill
              priority
              fetchPriority="high"
              sizes="100vw"
              quality={85}
              className="object-cover"
              placeholder="empty"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a14] via-[#0a0a14]/40 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#0a0a14]/60 via-transparent to-transparent" />
          </div>

          {/* Content */}
          <div className="relative z-10 mx-auto max-w-[1440px] w-full px-6 sm:px-12 lg:px-20 pb-24 lg:pb-32">
            <div className="max-w-2xl">
              <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-[#d4a853] mb-6">
                {locale === 'ar' ? 'مجموعة شتاء ٢٠٢٦' : locale === 'en' ? 'Winter Collection 2026' : 'Winterkollektion 2026'}
              </p>
              <h1 className="text-5xl sm:text-6xl lg:text-7xl xl:text-8xl font-light tracking-tight leading-[1] mb-6">
                {title}
              </h1>
              <p className="text-base sm:text-lg text-white/70 mb-10 max-w-md font-light">
                {subtitle}
              </p>
              <Link
                href={ctaLink}
                className="group inline-flex items-center gap-3 px-8 py-4 bg-[#d4a853] text-[#0a0a14] text-sm font-semibold uppercase tracking-[0.15em] hover:bg-[#e0b864] transition-colors"
              >
                {cta}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1" />
              </Link>
            </div>
          </div>

          {/* Bottom edge gradient for smooth scroll */}
          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#0a0a14] to-transparent pointer-events-none" />
        </section>
      )}

      {/* 2. Bestsellers — dark */}
      <section className="py-20 lg:py-28 dark-products-section">
        <FeaturedProducts
          title={t('bestsellers')}
          eyebrow={locale === 'ar' ? 'الأكثر مبيعاً' : locale === 'en' ? 'Most Popular' : 'Am beliebtesten'}
          sort="bestseller"
          locale={locale}
        />
      </section>

      {/* 3. Editorial Split — image left, text right */}
      <section className="py-20 lg:py-28">
        <div className="mx-auto max-w-[1440px] px-6 sm:px-12 lg:px-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <div className="relative aspect-[4/5] overflow-hidden">
              <Image
                src="https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=1200&q=85"
                alt="Editorial"
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover"
              />
            </div>
            <div className="space-y-6">
              <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#d4a853]">
                {locale === 'ar' ? 'حكاية' : locale === 'en' ? 'Story' : 'Geschichte'}
              </p>
              <h2 className="text-4xl sm:text-5xl lg:text-6xl font-light leading-tight tracking-tight">
                {locale === 'ar' ? 'حرفية بلا حدود' : locale === 'en' ? 'Crafted with Intention' : 'Mit Hingabe gefertigt'}
              </h2>
              <p className="text-white/60 text-lg font-light leading-relaxed max-w-lg">
                {locale === 'ar'
                  ? 'كل قطعة مصممة لتدوم. اختيار دقيق للأقمشة، تفاصيل لا تُنسى، وجودة تستحق الثقة.'
                  : locale === 'en'
                  ? 'Every piece is designed to last. Carefully selected fabrics, memorable details, and quality you can trust.'
                  : 'Jedes Stück ist für Langlebigkeit konzipiert. Sorgfältig ausgewählte Stoffe, einprägsame Details, Qualität der man vertrauen kann.'}
              </p>
              <Link
                href={`/${locale}/about`}
                className="inline-flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.15em] text-white border-b border-white/30 pb-1.5 hover:text-[#d4a853] hover:border-[#d4a853] transition-colors"
              >
                {locale === 'ar' ? 'اعرف المزيد' : locale === 'en' ? 'Learn more' : 'Mehr erfahren'}
                <ArrowRight className="h-4 w-4 rtl:rotate-180" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 4. New Arrivals — dark */}
      <section className="py-20 lg:py-28 dark-products-section">
        <FeaturedProducts
          title={t('newArrivals')}
          eyebrow={locale === 'ar' ? 'وصل حديثاً' : locale === 'en' ? 'Just Arrived' : 'Neu eingetroffen'}
          sort="newest"
          locale={locale}
        />
      </section>

      {/* 5. Newsletter — dark */}
      <section className="py-20 lg:py-28 border-t border-white/5">
        <NewsletterSection />
      </section>

      {/* Dark mode override for product sections */}
      <style jsx global>{`
        .dark-products-section {
          background: #0a0a14;
          color: white;
        }
        .dark-products-section [data-section-header] h2 {
          color: white !important;
        }
        .dark-products-section [data-section-header] p {
          color: rgba(212, 168, 83, 0.9) !important;
        }
      `}</style>
    </div>
  )
}
