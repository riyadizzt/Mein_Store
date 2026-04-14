import type { Metadata } from 'next'
import { fetchLegalContent, renderLegalAsHtml, type LegalLocale } from '@/lib/legal-content'

export const metadata: Metadata = { title: 'Widerrufsbelehrung' }
export const revalidate = 60

const FALLBACK_TITLE: Record<LegalLocale, string> = {
  de: 'Widerrufsbelehrung',
  en: 'Cancellation Policy',
  ar: 'سياسة الإلغاء',
}

const FALLBACK_NOTICE: Record<LegalLocale, string> = {
  de: 'Die Widerrufsbelehrung wird gerade vorbereitet. Bitte versuche es später erneut oder kontaktiere uns direkt.',
  en: 'The cancellation policy is being prepared. Please check back later or contact us directly.',
  ar: 'سياسة الإلغاء قيد الإعداد. يرجى المحاولة لاحقاً أو التواصل معنا مباشرة.',
}

export default async function WiderrufPage({
  params,
}: {
  params: { locale: string }
}) {
  const locale = (['de', 'en', 'ar'].includes(params.locale) ? params.locale : 'de') as LegalLocale
  const raw = await fetchLegalContent('widerruf', locale)

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
