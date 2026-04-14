import type { Metadata } from 'next'
import { fetchLegalContent, renderLegalAsHtml, type LegalLocale } from '@/lib/legal-content'

export const metadata: Metadata = { title: 'AGB' }
export const revalidate = 60

const FALLBACK_TITLE: Record<LegalLocale, string> = {
  de: 'Allgemeine Geschäftsbedingungen',
  en: 'Terms and Conditions',
  ar: 'الشروط والأحكام',
}

const FALLBACK_NOTICE: Record<LegalLocale, string> = {
  de: 'Unsere Allgemeinen Geschäftsbedingungen werden gerade vorbereitet. Bitte versuche es später erneut oder kontaktiere uns direkt.',
  en: 'Our Terms and Conditions are being prepared. Please check back later or contact us directly.',
  ar: 'الشروط والأحكام الخاصة بنا قيد الإعداد. يرجى المحاولة لاحقاً أو التواصل معنا مباشرة.',
}

export default async function AGBPage({
  params,
}: {
  params: { locale: string }
}) {
  const locale = (['de', 'en', 'ar'].includes(params.locale) ? params.locale : 'de') as LegalLocale
  const raw = await fetchLegalContent('agb', locale)

  if (!raw) {
    return (
      <>
        <h1>{FALLBACK_TITLE[locale]}</h1>
        <p>{FALLBACK_NOTICE[locale]}</p>
      </>
    )
  }

  const html = renderLegalAsHtml(raw)
  return <div dangerouslySetInnerHTML={{ __html: html }} />
}
