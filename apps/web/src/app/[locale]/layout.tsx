import { API_BASE_URL } from '@/lib/env'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { routing } from '@/i18n/routing'
import { Inter, Cairo, Outfit, Playfair_Display, Noto_Sans_Arabic } from 'next/font/google'
import { QueryProvider } from '@/providers/query-provider'
import { AuthProvider } from '@/providers/auth-provider'
import { ConfirmProvider } from '@/components/ui/confirm-modal'
import { StoreShell } from '@/components/layout/store-shell'
import { TrackingPixels } from '@/components/tracking-pixels'
import { WhatsAppButton } from '@/components/whatsapp-button'
import { Suspense } from 'react'
import { UtmCapture } from '@/components/utm-capture'
import { AiChatWidget } from '@/components/ai/chat-widget'
import { PostHogProvider } from '@/providers/posthog-provider'
import { MaintenanceCheck } from '@/components/maintenance-check'
import '../globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })
const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit', weight: ['300', '400', '500', '600', '700'] })
const playfair = Playfair_Display({ subsets: ['latin'], variable: '--font-display', weight: ['400', '500', '600', '700'] })
const cairo = Cairo({ subsets: ['arabic'], variable: '--font-arabic' })
const notoArabic = Noto_Sans_Arabic({ subsets: ['arabic'], variable: '--font-noto-arabic', weight: ['400', '500', '600', '700'] })

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'metadata' })
  return {
    title: { template: `%s | ${t('siteName')}`, default: t('siteName') },
    description: t('description'),
  }
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export default async function LocaleLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  if (!routing.locales.includes(locale as any)) {
    notFound()
  }

  const messages = await getMessages()
  const direction = locale === 'ar' ? 'rtl' : 'ltr'
  const fontClass = locale === 'ar' ? `${cairo.variable} ${notoArabic.variable}` : `${outfit.variable} ${inter.variable}`

  return (
    <html lang={locale} dir={direction}>
      <head>
        <link rel="dns-prefetch" href="https://images.unsplash.com" />
        <link rel="dns-prefetch" href="https://placehold.co" />
        <link rel="preconnect" href={API_BASE_URL} />
      </head>
      <body className={`${outfit.className} ${fontClass} ${playfair.variable} antialiased`}>
        <NextIntlClientProvider messages={messages}>
          <QueryProvider>
            <AuthProvider>
              <ConfirmProvider>
                <StoreShell locale={locale}>
                  {children}
                </StoreShell>
                <Suspense><UtmCapture /></Suspense>
                <Suspense><PostHogProvider><></></PostHogProvider></Suspense>
                <MaintenanceCheck />
                <TrackingPixels />
                <WhatsAppButton />
                <AiChatWidget />
              </ConfirmProvider>
            </AuthProvider>
          </QueryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
