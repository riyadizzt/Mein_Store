import { useTranslations } from 'next-intl'
import { HeroBanner } from '@/components/layout/hero-banner'
import { TrustSignals } from '@/components/layout/trust-signals'
import { CategoryGrid } from '@/components/layout/category-grid'
import { ProductScroll } from '@/components/product/product-scroll'
import { TrustCounter } from '@/components/overdrive/trust-counter'

export const revalidate = 60 // ISR: regenerate every 60s

export default function HomePage({
  params: { locale },
}: {
  params: { locale: string }
}) {
  const t = useTranslations('home')

  return (
    <>
      <HeroBanner locale={locale} />
      <TrustSignals />

      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl sm:text-3xl font-bold">{t('categories')}</h2>
        </div>
        <CategoryGrid />
      </section>

      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pb-12 sm:pb-16">
        <ProductScroll title={t('bestsellers')} sort="bestseller" />
      </section>

      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pb-16 sm:pb-20">
        <ProductScroll title={t('newArrivals')} sort="newest" />
      </section>

      <TrustCounter />

      {/* Recently Viewed - handled client-side */}
    </>
  )
}
