'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Instagram, Facebook, Cookie } from 'lucide-react'
import { useConsentStore } from '@/store/consent-store'
import { useShopSettings } from '@/hooks/use-shop-settings'
import { useCategories } from '@/hooks/use-categories'
import { VisaLogo, MastercardLogo, PayPalLogo, KlarnaLogo, SumUpLogo } from '@/components/ui/payment-logos'

/* ── TikTok SVG ── */
const TikTokIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V9.39a8.16 8.16 0 004.76 1.52V7.46a4.85 4.85 0 01-1-.77z" />
  </svg>
)

/* ── Footer Link with gold underline hover ── */
function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="relative inline-block text-[15px] text-white/50 hover:text-white transition-colors duration-200 pb-0.5 group"
      >
        {children}
        <span className="absolute bottom-0 left-0 rtl:left-auto rtl:right-0 w-0 h-px bg-brand-gold transition-all duration-300 group-hover:w-full" />
      </Link>
    </li>
  )
}

/* ── Main Footer Component ── */
export function Footer({ locale }: { locale: string }) {
  const t = useTranslations('footer')
  const tc = useTranslations('common')
  const { data: shopSettings } = useShopSettings()
  const { data: categories } = useCategories()
  const departments = (categories ?? []).filter((c: any) => !c.parentId) as any[]
  const brandName = shopSettings?.brandName || 'Malak Bekleidung'
  const isSingleWord = !brandName.trim().includes(' ')

  return (
    <footer>
      {/* ═══════════════════════════════════════════════════════
          Links + Brand (Trust + Newsletter sind auf der Homepage)
          ═══════════════════════════════════════════════════════ */}
      <div className="bg-[#0a0a0a] text-white/60">
        <div className="mx-auto max-w-[1440px] px-6 sm:px-8 lg:px-12 pt-14 sm:pt-18 pb-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10 lg:gap-16">

            {/* Brand */}
            <div className="col-span-2 md:col-span-1">
              <span
                className={`font-display font-bold text-white logo-shimmer uppercase ${
                  isSingleWord ? 'text-2xl tracking-[0.3em]' : 'text-xl tracking-[0.15em]'
                }`}
              >
                {brandName}
              </span>
              <p className="mt-4 text-sm text-white/65 leading-relaxed max-w-[220px]">
                {t('tagline')}
              </p>
              <div className="flex gap-2.5 mt-6">
                {[
                  { label: 'Instagram', icon: <Instagram className="h-5 w-5" /> },
                  { label: 'Facebook', icon: <Facebook className="h-5 w-5" /> },
                  { label: 'TikTok', icon: <TikTokIcon /> },
                ].map(({ label, icon }) => (
                  <a
                    key={label}
                    href="#"
                    aria-label={label}
                    className="h-11 w-11 rounded-full border border-white/10 flex items-center justify-center text-white/35 transition-all duration-300 hover:border-brand-gold/40 hover:text-brand-gold"
                  >
                    {icon}
                  </a>
                ))}
              </div>
            </div>

            {/* Shop — dynamic from categories API */}
            <div>
              <h2 className="text-xs font-bold text-[#d4a853] tracking-[0.2em] uppercase mb-6">{t('shop')}</h2>
              <ul className="space-y-4">
                <FooterLink href={`/${locale}/products`}>{t('allProducts')}</FooterLink>
                {departments.map((dept) => {
                  const name = dept.translations?.find((t: any) => t.language === locale)?.name
                    ?? dept.translations?.find((t: any) => t.language === 'de')?.name
                    ?? dept.slug
                  return (
                    <FooterLink key={dept.id} href={`/${locale}/products?department=${dept.slug}`}>{name}</FooterLink>
                  )
                })}
              </ul>
            </div>

            {/* Customer Service */}
            <div>
              <h2 className="text-xs font-bold text-[#d4a853] tracking-[0.2em] uppercase mb-6">{t('customerService')}</h2>
              <ul className="space-y-4">
                <FooterLink href={`/${locale}/contact`}>{t('contact')}</FooterLink>
                <FooterLink href={`/${locale}/tracking`}>{t('trackOrder')}</FooterLink>
                <FooterLink href={`/${locale}/legal/widerruf`}>{t('returnsAndWithdrawal')}</FooterLink>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h2 className="text-xs font-bold text-[#d4a853] tracking-[0.2em] uppercase mb-6">{t('legal')}</h2>
              <ul className="space-y-4">
                <FooterLink href={`/${locale}/legal/impressum`}>{t('imprint')}</FooterLink>
                <FooterLink href={`/${locale}/legal/datenschutz`}>{t('privacy')}</FooterLink>
                <FooterLink href={`/${locale}/legal/agb`}>{t('terms')}</FooterLink>
                <FooterLink href={`/${locale}/legal/widerruf`}>{t('withdrawal')}</FooterLink>
                <li>
                  <button
                    onClick={() => useConsentStore.getState().openSettings()}
                    className="relative inline-flex items-center gap-1.5 text-base text-white/60 hover:text-white transition-colors duration-200 pb-0.5 group"
                  >
                    <Cookie className="h-3.5 w-3.5" />
                    {locale === 'ar' ? 'إعدادات الكوكيز' : locale === 'en' ? 'Cookie Settings' : 'Cookie-Einstellungen'}
                    <span className="absolute bottom-0 left-0 rtl:left-auto rtl:right-0 w-0 h-px bg-[#d4a853] transition-all duration-300 group-hover:w-full" />
                  </button>
                </li>
              </ul>
            </div>
          </div>

          {/* Divider */}
          <div className="mt-12 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />

          {/* Bottom — Payments + Copyright */}
          <div className="mt-8 flex flex-col items-center gap-5">
            <div className="flex flex-col items-center gap-3">
              <span className="text-[11px] font-semibold text-white/65 uppercase tracking-[0.18em]">
                {locale === 'ar' ? 'نقبل الدفع عبر' : locale === 'en' ? 'We accept' : 'Wir akzeptieren'}
              </span>
              <div className="flex items-center gap-2.5 flex-wrap justify-center">
                <div className="h-9 px-3 rounded-md bg-white border border-white/20 flex items-center">
                  <VisaLogo className="h-7" />
                </div>
                <div className="h-9 px-3 rounded-md bg-white border border-white/20 flex items-center">
                  <MastercardLogo className="h-7" />
                </div>
                <div className="h-9 px-3 rounded-md bg-white border border-white/20 flex items-center">
                  <PayPalLogo className="h-5" />
                </div>
                <div className="h-9 px-2 rounded-md bg-white border border-white/20 flex items-center">
                  <KlarnaLogo className="h-5" />
                </div>
                <div className="h-9 px-2 rounded-md bg-white border border-white/20 flex items-center">
                  <SumUpLogo className="h-5" />
                </div>
                {/* Apple Pay */}
                <div className="h-9 w-[4.5rem] rounded-md bg-black border border-white/20 flex items-center justify-center">
                  <span className="text-white text-[13px] font-semibold tracking-tight flex items-center gap-0.5">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="white"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>Pay
                  </span>
                </div>
                {/* Google Pay */}
                <div className="h-9 w-[4.5rem] rounded-md bg-white border border-white/20 flex items-center justify-center">
                  <span className="text-[13px] font-semibold tracking-tight flex items-center gap-0.5">
                    <svg className="h-4 w-4" viewBox="0 0 24 24"><path d="M12.24 10.28V14.1h5.41c-.24 1.52-1.78 4.44-5.41 4.44-3.25 0-5.91-2.69-5.91-6.01s2.65-6.01 5.91-6.01c1.85 0 3.09.79 3.8 1.47l2.59-2.49C16.64 3.65 14.64 2.7 12.24 2.7 6.76 2.7 2.3 7.13 2.3 12.54s4.46 9.84 9.94 9.84c5.74 0 9.55-4.03 9.55-9.72 0-.65-.07-1.15-.16-1.65h-9.39z" fill="#4285F4"/></svg>
                    <span className="text-[#3C4043]">Pay</span>
                  </span>
                </div>
              </div>
            </div>
            {/* App Store Badges — Coming Soon (Premium) */}
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="h-px w-8 bg-gradient-to-r from-transparent to-[#d4a853]/40" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                  <span className="text-white/50">{locale === 'ar' ? 'تطبيقاتنا' : locale === 'en' ? 'Our Apps' : 'Unsere Apps'}</span>
                  <span className="text-[#d4a853] ltr:ml-1.5 rtl:mr-1.5">{locale === 'ar' ? '— قريباً' : locale === 'en' ? '— Coming Soon' : '— Bald verfügbar'}</span>
                </span>
                <div className="h-px w-8 bg-gradient-to-l from-transparent to-[#d4a853]/40" />
              </div>
              <div className="flex items-center gap-3">
                {/* Apple App Store Badge */}
                <div className="group relative flex items-center gap-2.5 px-5 py-2.5 rounded-xl bg-gradient-to-b from-white/[0.08] to-white/[0.04] border border-white/[0.08] hover:border-[#d4a853]/30 hover:from-white/[0.12] hover:to-white/[0.06] transition-all duration-300 cursor-default overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-r from-[#d4a853]/0 via-[#d4a853]/[0.03] to-[#d4a853]/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <svg className="relative h-7 w-7 text-white/90" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                  </svg>
                  <div className="relative leading-none">
                    <div className="text-[9px] text-[#d4a853]/80 font-medium">{locale === 'ar' ? 'قريباً على' : locale === 'en' ? 'Soon on' : 'Bald im'}</div>
                    <div className="text-[15px] font-bold text-white/90 tracking-tight">App Store</div>
                  </div>
                </div>
                {/* Google Play Badge */}
                <div className="group relative flex items-center gap-2.5 px-5 py-2.5 rounded-xl bg-gradient-to-b from-white/[0.08] to-white/[0.04] border border-white/[0.08] hover:border-[#d4a853]/30 hover:from-white/[0.12] hover:to-white/[0.06] transition-all duration-300 cursor-default overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-r from-[#d4a853]/0 via-[#d4a853]/[0.03] to-[#d4a853]/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <svg className="relative h-7 w-7 text-white/90" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3.18 23.64c-.38-.43-.56-1.06-.56-1.88V2.24c0-.82.18-1.45.56-1.88L14.26 12 3.18 23.64zM15.36 13.1l3.07 1.78-2.07 2.07L15.36 13.1zm4.15-2.42l2.07 1.2c.66.38.66 1 0 1.38l-2.07 1.2-2.37-2.37-.01-.01 2.38-2.4zM15.36 10.9l1-3.85 2.07 2.07-3.07 1.78zM4.49.75L14.84 11.1l-1.67 1.67L4.49.75zm0 22.5l8.68-12.02 1.67 1.67L4.49 23.25z"/>
                  </svg>
                  <div className="relative leading-none">
                    <div className="text-[9px] text-[#d4a853]/80 font-medium">{locale === 'ar' ? 'قريباً على' : locale === 'en' ? 'Soon on' : 'Bald auf'}</div>
                    <div className="text-[15px] font-bold text-white/90 tracking-tight">Google Play</div>
                  </div>
                </div>
              </div>
            </div>

            <p className="text-sm text-white/65">
              &copy; {new Date().getFullYear()} Malak Bekleidung. {tc('allRightsReserved')}
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}
