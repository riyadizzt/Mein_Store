import type { Metadata } from 'next'
import { fetchLegalContent, renderLegalAsHtml, type LegalLocale } from '@/lib/legal-content'

export const metadata: Metadata = { title: 'Impressum' }
export const revalidate = 60

const FALLBACK_TITLE: Record<LegalLocale, string> = {
  de: 'Impressum',
  en: 'Legal Notice',
  ar: 'البيانات القانونية',
}

const FALLBACK_NOTICE: Record<LegalLocale, string> = {
  de: 'Der Inhalt dieser Seite wird gerade vorbereitet. Bitte versuche es später erneut oder kontaktiere uns direkt.',
  en: 'The content of this page is being prepared. Please check back later or contact us directly.',
  ar: 'محتوى هذه الصفحة قيد الإعداد. يرجى المحاولة لاحقاً أو التواصل معنا مباشرة.',
}

export default async function ImpressumPage({
  params,
}: {
  params: { locale: string }
}) {
  const locale = (['de', 'en', 'ar'].includes(params.locale) ? params.locale : 'de') as LegalLocale
  const raw = await fetchLegalContent('impressum', locale)

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
