import type { Metadata } from 'next'
import { fetchLegalContent, renderLegalAsHtml, type LegalLocale } from '@/lib/legal-content'

export const metadata: Metadata = { title: 'Datenschutzerklärung' }
export const revalidate = 60

const FALLBACK_TITLE: Record<LegalLocale, string> = {
  de: 'Datenschutzerklärung',
  en: 'Privacy Policy',
  ar: 'سياسة الخصوصية',
}

const FALLBACK_NOTICE: Record<LegalLocale, string> = {
  de: 'Unsere Datenschutzerklärung wird gerade vorbereitet. Bitte versuche es später erneut oder kontaktiere uns direkt.',
  en: 'Our Privacy Policy is being prepared. Please check back later or contact us directly.',
  ar: 'سياسة الخصوصية الخاصة بنا قيد الإعداد. يرجى المحاولة لاحقاً أو التواصل معنا مباشرة.',
}

export default async function DatenschutzPage({
  params,
}: {
  params: { locale: string }
}) {
  const locale = (['de', 'en', 'ar'].includes(params.locale) ? params.locale : 'de') as LegalLocale
  const raw = await fetchLegalContent('datenschutz', locale)

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
