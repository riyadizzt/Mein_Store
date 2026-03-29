import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { routing } from '@/i18n/routing'
import { Inter, Cairo } from 'next/font/google'
import { QueryProvider } from '@/providers/query-provider'
import { AuthProvider } from '@/providers/auth-provider'
import { StoreShell } from '@/components/layout/store-shell'
import '../globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })
const cairo = Cairo({ subsets: ['arabic'], variable: '--font-arabic' })

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
  const fontClass = locale === 'ar' ? cairo.variable : inter.variable

  return (
    <html lang={locale} dir={direction}>
      <head>
        <link rel="dns-prefetch" href="https://images.unsplash.com" />
        <link rel="dns-prefetch" href="https://placehold.co" />
        <link rel="preconnect" href={process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'} />
      </head>
      <body className={`${inter.className} ${fontClass} antialiased`}>
        <NextIntlClientProvider messages={messages}>
          <QueryProvider>
            <AuthProvider>
              <StoreShell locale={locale}>
                {children}
              </StoreShell>
            </AuthProvider>
          </QueryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
