'use client'

import { useLocale } from 'next-intl'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { api } from '@/lib/api'

const t3 = (locale: string, d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

// Editorial sections with placeholder images (admin replaces later)
const SECTIONS = [
  {
    key: 'hero',
    image: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=1200&h=600&fit=crop',
    titleDe: 'Kollektion Frühling/Sommer',
    titleAr: 'مجموعة الربيع/الصيف',
    titleEn: 'Spring/Summer Collection',
    subtitleDe: 'Entdecke die neuen Trends',
    subtitleAr: 'اكتشف أحدث الصيحات',
    subtitleEn: 'Discover the latest trends',
  },
  {
    key: 'casual',
    image: 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=800&h=1000&fit=crop',
    titleDe: 'Casual Eleganz',
    titleAr: 'أناقة يومية',
    titleEn: 'Casual Elegance',
    descDe: 'Zeitlose Basics die zu allem passen. Qualität die man spürt.',
    descAr: 'أساسيات خالدة تناسب كل شيء. جودة تلمسها.',
    descEn: 'Timeless basics that go with everything. Quality you can feel.',
  },
  {
    key: 'evening',
    image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=800&h=1000&fit=crop',
    titleDe: 'Abendgarderobe',
    titleAr: 'ملابس السهرة',
    titleEn: 'Evening Wear',
    descDe: 'Für besondere Anlässe. Elegant, sophisticated, unvergesslich.',
    descAr: 'للمناسبات الخاصة. أنيقة، راقية، لا تُنسى.',
    descEn: 'For special occasions. Elegant, sophisticated, unforgettable.',
  },
  {
    key: 'street',
    image: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=800&h=1000&fit=crop',
    titleDe: 'Streetstyle',
    titleAr: 'أزياء الشارع',
    titleEn: 'Street Style',
    descDe: 'Urban. Modern. Selbstbewusst. Mode die Statements setzt.',
    descAr: 'عصرية. حديثة. واثقة. أزياء تصنع الفارق.',
    descEn: 'Urban. Modern. Confident. Fashion that makes statements.',
  },
]

export default function LookbookPage() {
  const locale = useLocale()

  const { data: products } = useQuery({
    queryKey: ['lookbook-products'],
    queryFn: async () => {
      const { data } = await api.get(`/products?lang=${locale}&limit=8&sort=newest`)
      return data?.data ?? data?.items ?? data ?? []
    },
    staleTime: 300000,
  })

  const hero = SECTIONS[0]
  const editorialSections = SECTIONS.slice(1)

  return (
    <div>
      {/* ═══ HERO ═══ */}
      <section className="relative h-[60vh] sm:h-[70vh] overflow-hidden">
        <img src={hero.image} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        <div className="relative z-10 h-full flex flex-col items-center justify-end text-center text-white px-6 pb-16">
          <p className="text-xs tracking-[0.3em] uppercase text-white/60 mb-4">MALAK BEKLEIDUNG</p>
          <h1 className="font-display font-light text-3xl sm:text-5xl md:text-6xl leading-tight mb-4">
            {locale === 'ar' ? hero.titleAr : locale === 'en' ? hero.titleEn : hero.titleDe}
          </h1>
          <p className="text-base sm:text-lg text-white/70 max-w-lg">
            {locale === 'ar' ? hero.subtitleAr : locale === 'en' ? hero.subtitleEn : hero.subtitleDe}
          </p>
          <Link href={`/${locale}/products`} className="mt-8 inline-flex items-center gap-2 px-8 py-3 border border-white/30 text-sm tracking-[0.15em] uppercase hover:bg-white hover:text-[#1a1a2e] transition-all duration-500">
            {t3(locale, 'Jetzt entdecken', 'Explore Now', 'استكشف الآن')}
            <ArrowRight className={`h-4 w-4 ${locale === 'ar' ? 'rotate-180' : ''}`} />
          </Link>
        </div>
      </section>

      {/* ═══ EDITORIAL SECTIONS ═══ */}
      <div className="mx-auto max-w-[1440px] px-4 sm:px-8 lg:px-12">

        {/* Intro text */}
        <div className="py-20 text-center max-w-2xl mx-auto">
          <p className="text-sm tracking-[0.2em] uppercase text-[#d4a853] mb-4">Lookbook</p>
          <h2 className={`text-2xl sm:text-3xl leading-relaxed text-[#0f1419] ${locale === 'ar' ? 'font-arabic font-semibold' : 'font-display font-light'}`}>
            {t3(locale,
              'Mode ist nicht nur Kleidung. Es ist ein Ausdruck von wer du bist.',
              'Fashion is not just clothing. It\'s an expression of who you are.',
              'الموضة ليست مجرد ملابس. إنها تعبير عن هويتك.'
            )}
          </h2>
        </div>

        {/* Alternating editorial blocks */}
        {editorialSections.map((section, i) => (
          <section key={section.key} className={`grid grid-cols-1 lg:grid-cols-2 gap-0 mb-1 ${i % 2 === 1 ? 'lg:direction-ltr' : ''}`}>
            {/* Image */}
            <div className={`relative aspect-[4/5] lg:aspect-auto overflow-hidden ${i % 2 === 1 ? 'lg:order-2' : ''}`}>
              <img src={section.image} alt={locale === 'ar' ? section.titleAr : section.titleDe} className="w-full h-full object-cover hover:scale-[1.02] transition-transform duration-700" loading="lazy" />
            </div>
            {/* Text */}
            <div className={`flex items-center ${i % 2 === 1 ? 'lg:order-1' : ''}`}>
              <div className="px-8 sm:px-12 lg:px-16 py-16 lg:py-0 max-w-lg">
                <p className="text-xs tracking-[0.2em] uppercase text-[#d4a853] mb-4">
                  {String(i + 1).padStart(2, '0')}
                </p>
                <h3 className={`text-2xl sm:text-3xl mb-6 text-[#0f1419] ${locale === 'ar' ? 'font-arabic font-semibold' : 'font-display font-light'}`}>
                  {locale === 'ar' ? section.titleAr : locale === 'en' ? section.titleEn : section.titleDe}
                </h3>
                <p className="text-base text-[#0f1419]/50 leading-relaxed mb-8">
                  {locale === 'ar' ? section.descAr : locale === 'en' ? section.descEn : section.descDe}
                </p>
                <Link href={`/${locale}/products`} className="inline-flex items-center gap-2 text-sm text-[#d4a853] tracking-[0.1em] uppercase hover:text-[#c49b45] transition-colors">
                  {t3(locale, 'Kollektion ansehen', 'View Collection', 'عرض المجموعة')}
                  <ArrowRight className={`h-4 w-4 ${locale === 'ar' ? 'rotate-180' : ''}`} />
                </Link>
              </div>
            </div>
          </section>
        ))}

        {/* ═══ FEATURED PRODUCTS ═══ */}
        {products && products.length > 0 && (
          <section className="py-20">
            <div className="text-center mb-12">
              <p className="text-xs tracking-[0.2em] uppercase text-[#d4a853] mb-3">
                {t3(locale, 'Aus dem Lookbook', 'From the Lookbook', 'من دفتر الأزياء')}
              </p>
              <h2 className={`text-2xl sm:text-3xl text-[#0f1419] ${locale === 'ar' ? 'font-arabic font-semibold' : 'font-display font-light'}`}>
                {t3(locale, 'Unsere Favoriten', 'Our Favorites', 'مفضلاتنا')}
              </h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {products.slice(0, 4).map((p: any) => {
                const name = p.name ?? p.translations?.[0]?.name ?? p.slug
                const image = p.imageUrl ?? p.images?.[0]?.url
                const price = p.salePrice ?? p.basePrice
                return (
                  <Link key={p.id} href={`/${locale}/products/${p.slug}`} className="group">
                    <div className="aspect-[3/4] bg-[#f5f5f5] overflow-hidden mb-3">
                      {image ? (
                        <img src={image} alt={name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"><span className="text-2xl text-[#d5d5d5]">{(name ?? '?').charAt(0).toUpperCase()}</span></div>
                      )}
                    </div>
                    <p className="text-sm text-[#0f1419] truncate">{name}</p>
                    <p className="text-sm text-[#0f1419]/50 mt-0.5 tabular-nums">&euro;{Number(price).toFixed(2)}</p>
                  </Link>
                )
              })}
            </div>
          </section>
        )}

        {/* ═══ BRAND QUOTE ═══ */}
        <section className="py-20 border-t border-[#e5e5e5]">
          <blockquote className="text-center max-w-2xl mx-auto">
            <p className={`text-xl sm:text-2xl leading-relaxed text-[#0f1419]/70 italic ${locale === 'ar' ? 'font-arabic' : 'font-display'}`}>
              {t3(locale,
                '„Qualität bedeutet, die richtigen Dinge zu tun, auch wenn niemand zuschaut."',
                '"Quality means doing the right things, even when no one is watching."',
                '«الجودة تعني فعل الأشياء الصحيحة، حتى عندما لا يراقبك أحد.»'
              )}
            </p>
            <p className="mt-6 text-xs tracking-[0.2em] uppercase text-[#d4a853]">— MALAK BEKLEIDUNG</p>
          </blockquote>
        </section>
      </div>
    </div>
  )
}
