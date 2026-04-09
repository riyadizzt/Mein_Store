'use client'

import { useLocale } from 'next-intl'
import Link from 'next/link'
import { Heart, Shield, Truck, Award, Mail } from 'lucide-react'

const t3 = (locale: string, d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

const VALUES = [
  { icon: Award, titleDe: 'Premium Qualität', titleAr: 'جودة ممتازة', titleEn: 'Premium Quality', descDe: 'Wir wählen nur die besten Stoffe und arbeiten mit erfahrenen Lieferanten zusammen.', descAr: 'نختار فقط أفضل الأقمشة ونعمل مع موردين ذوي خبرة.', descEn: 'We select only the finest fabrics and work with experienced suppliers.' },
  { icon: Heart, titleDe: 'Mit Leidenschaft', titleAr: 'بشغف', titleEn: 'With Passion', descDe: 'Jedes Stück wird mit Liebe zum Detail ausgewählt und präsentiert.', descAr: 'كل قطعة يتم اختيارها وتقديمها بعناية فائقة بالتفاصيل.', descEn: 'Every piece is selected and presented with love for detail.' },
  { icon: Shield, titleDe: 'Vertrauen & Sicherheit', titleAr: 'ثقة وأمان', titleEn: 'Trust & Security', descDe: 'DSGVO-konform, sichere Zahlungen, transparente Geschäftspraktiken.', descAr: 'متوافق مع حماية البيانات، مدفوعات آمنة، ممارسات تجارية شفافة.', descEn: 'GDPR compliant, secure payments, transparent business practices.' },
  { icon: Truck, titleDe: 'Schneller Versand', titleAr: 'شحن سريع', titleEn: 'Fast Shipping', descDe: 'Versand innerhalb von 1-3 Werktagen. Kostenlos ab 100€.', descAr: 'شحن خلال 1-3 أيام عمل. مجاني فوق 100 يورو.', descEn: 'Shipping within 1-3 business days. Free over €100.' },
]

export default function AboutPage() {
  const locale = useLocale()

  return (
    <div>
      {/* ═══ HERO ═══ */}
      <section className="relative h-[50vh] sm:h-[60vh] bg-[#1a1a2e] flex items-center justify-center text-center overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 30% 50%, rgba(212,168,83,0.3), transparent 60%), radial-gradient(circle at 70% 50%, rgba(100,60,160,0.2), transparent 60%)' }} />
        <div className="relative z-10 px-6">
          <p className="text-xs tracking-[0.4em] uppercase text-[#d4a853] mb-6">MALAK BEKLEIDUNG</p>
          <h1 className={`text-3xl sm:text-5xl text-white leading-tight mb-6 ${locale === 'ar' ? 'font-arabic font-bold' : 'font-display font-light'}`}>
            {t3(locale, 'Unsere Geschichte', 'Our Story', 'قصتنا')}
          </h1>
          <p className="text-base sm:text-lg text-white/50 max-w-lg mx-auto">
            {t3(locale,
              'Mode & Qualität aus Berlin — seit 2021',
              'Fashion & Quality from Berlin — since 2021',
              'أزياء وجودة من برلين — منذ 2021'
            )}
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-[1440px] px-4 sm:px-8 lg:px-12">

        {/* ═══ BRAND STORY ═══ */}
        <section className="py-20 max-w-3xl mx-auto text-center">
          <h2 className={`text-2xl sm:text-3xl text-[#0f1419] mb-8 ${locale === 'ar' ? 'font-arabic font-semibold' : 'font-display font-light'}`}>
            {t3(locale, 'Wer wir sind', 'Who We Are', 'من نحن')}
          </h2>
          <div className="space-y-6 text-base text-[#0f1419]/60 leading-relaxed">
            <p>
              {t3(locale,
                'Malak Bekleidung wurde 2021 in Berlin gegründet mit einer klaren Vision: Mode von Premium-Qualität zu fairen Preisen anzubieten. Wir glauben daran, dass gute Kleidung nicht teuer sein muss — aber immer gut verarbeitet.',
                'Malak Bekleidung was founded in 2021 in Berlin with a clear vision: to offer premium quality fashion at fair prices. We believe that good clothing doesn\'t have to be expensive — but always well crafted.',
                'تأسست ملاك للملابس في عام 2021 في برلين برؤية واضحة: تقديم أزياء عالية الجودة بأسعار عادلة. نؤمن بأن الملابس الجيدة لا يجب أن تكون باهظة الثمن — لكنها دائماً متقنة الصنع.'
              )}
            </p>
            <p>
              {t3(locale,
                'Unser Sortiment umfasst Damen-, Herren- und Kindermode — von Basics bis hin zu besonderen Anlässen. Jedes Stück wird sorgfältig ausgewählt und auf Qualität geprüft, bevor es in unseren Shop kommt.',
                'Our range includes women\'s, men\'s and children\'s fashion — from basics to special occasions. Each piece is carefully selected and quality checked before it comes to our shop.',
                'تشمل مجموعتنا أزياء النساء والرجال والأطفال — من الأساسيات إلى المناسبات الخاصة. يتم اختيار كل قطعة بعناية وفحص جودتها قبل وصولها إلى متجرنا.'
              )}
            </p>
            <p>
              {t3(locale,
                'Als deutsches Unternehmen mit Wurzeln in der arabischen Kultur verbinden wir zwei Welten: Europäische Qualitätsstandards und orientalische Gastfreundschaft. Unsere Kunden sind unsere Familie.',
                'As a German company with roots in Arab culture, we connect two worlds: European quality standards and oriental hospitality. Our customers are our family.',
                'كشركة ألمانية ذات جذور في الثقافة العربية، نربط بين عالمين: معايير الجودة الأوروبية وكرم الضيافة الشرقية. عملاؤنا هم عائلتنا.'
              )}
            </p>
          </div>
        </section>

        {/* ═══ VALUES ═══ */}
        <section className="py-16 border-t border-[#e5e5e5]">
          <h2 className={`text-2xl text-center text-[#0f1419] mb-12 ${locale === 'ar' ? 'font-arabic font-semibold' : 'font-display font-light'}`}>
            {t3(locale, 'Unsere Werte', 'Our Values', 'قيمنا')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {VALUES.map(v => (
              <div key={v.titleDe} className="text-center">
                <div className="h-14 w-14 rounded-2xl bg-[#d4a853]/10 flex items-center justify-center mx-auto mb-5">
                  <v.icon className="h-6 w-6 text-[#d4a853]" strokeWidth={1.5} />
                </div>
                <h3 className="text-base font-semibold text-[#0f1419] mb-2">
                  {locale === 'ar' ? v.titleAr : locale === 'en' ? v.titleEn : v.titleDe}
                </h3>
                <p className="text-sm text-[#0f1419]/45 leading-relaxed">
                  {locale === 'ar' ? v.descAr : locale === 'en' ? v.descEn : v.descDe}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ═══ NUMBERS ═══ */}
        <section className="py-16 border-t border-[#e5e5e5]">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 text-center">
            {[
              { value: '2021', label: t3(locale, 'Gegründet', 'Founded', 'تأسست') },
              { value: '2.000+', label: t3(locale, 'Zufriedene Kunden', 'Happy Customers', 'عملاء سعداء') },
              { value: '500+', label: t3(locale, 'Produkte', 'Products', 'منتج') },
              { value: 'Berlin', label: t3(locale, 'Standort', 'Location', 'الموقع') },
            ].map(stat => (
              <div key={stat.label}>
                <p className="text-3xl sm:text-4xl font-bold text-[#0f1419] tabular-nums" dir="ltr">{stat.value}</p>
                <p className="text-sm text-[#0f1419]/40 mt-2">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ═══ CONTACT CTA ═══ */}
        <section className="py-20 border-t border-[#e5e5e5]">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className={`text-2xl text-[#0f1419] mb-4 ${locale === 'ar' ? 'font-arabic font-semibold' : 'font-display font-light'}`}>
              {t3(locale, 'Kontaktiere uns', 'Get in Touch', 'تواصل معنا')}
            </h2>
            <p className="text-base text-[#0f1419]/45 mb-8">
              {t3(locale,
                'Hast du Fragen oder möchtest mehr über uns erfahren? Wir freuen uns auf deine Nachricht.',
                'Have questions or want to learn more about us? We look forward to your message.',
                'هل لديك أسئلة أو تريد معرفة المزيد عنا؟ نتطلع لرسالتك.'
              )}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href={`/${locale}/contact`} className="px-8 py-3 bg-[#d4a853] text-white text-sm tracking-[0.1em] font-medium hover:bg-[#c49b45] transition-colors">
                {t3(locale, 'Nachricht senden', 'Send Message', 'إرسال رسالة')}
              </Link>
              <div className="flex items-center gap-6 text-sm text-[#0f1419]/40">
                <span className="flex items-center gap-1.5"><Mail className="h-4 w-4" /> info@malak-bekleidung.com</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
