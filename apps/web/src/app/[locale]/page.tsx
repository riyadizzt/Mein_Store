import { useTranslations } from 'next-intl'
import { HeroWithCampaign } from '@/components/home/hero-with-campaign'
import { TrustSignals } from '@/components/layout/trust-signals'
import { CategoryShowcase } from '@/components/home/category-showcase'
import { FeaturedProducts } from '@/components/home/featured-products'
import { EditorialBanner } from '@/components/home/editorial-banner'
import { NewsletterSection } from '@/components/home/newsletter-section'

export const revalidate = 60

export default function HomePage({
  params: { locale },
}: {
  params: { locale: string }
}) {
  const t = useTranslations('home')

  return (
    <>
      {/* 1. Hero — full viewport, immersive */}
      <HeroWithCampaign locale={locale} />

      {/* 2. Trust signals bar */}
      <TrustSignals />

      {/* 3. Categories — asymmetric showcase */}
      <CategoryShowcase />

      {/* 4. Bestsellers */}
      <FeaturedProducts
        title={t('bestsellers')}
        eyebrow={locale === 'ar' ? 'الأكثر مبيعاً' : locale === 'en' ? 'Most Popular' : 'Am beliebtesten'}
        sort="bestseller"
        locale={locale}
      />

      {/* 5. Editorial brand statement */}
      <EditorialBanner locale={locale} />

      {/* 6. New Arrivals — subtle bg change for rhythm */}
      <FeaturedProducts
        title={t('newArrivals')}
        eyebrow={locale === 'ar' ? 'وصل حديثاً' : locale === 'en' ? 'Just Arrived' : 'Neu eingetroffen'}
        sort="newest"
        locale={locale}
        bgClass="bg-paper"
      />

      {/* 8. Newsletter — dark section for contrast */}
      <NewsletterSection />
    </>
  )
}
