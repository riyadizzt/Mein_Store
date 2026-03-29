import { useTranslations, useLocale } from 'next-intl'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function NotFoundPage() {
  const t = useTranslations('errors')
  const locale = useLocale()

  return (
    <div className="min-h-[60vh] flex items-center justify-center py-16">
      <div className="max-w-md w-full text-center px-4">
        <p className="text-8xl font-bold text-muted-foreground/20 mb-4">404</p>
        <h1 className="text-2xl font-bold mb-2">{t('notFound')}</h1>
        <p className="text-muted-foreground mb-8">{t('notFoundMessage')}</p>

        {/* Search */}
        <form action={`/${locale}/products`} className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            name="q"
            placeholder={`${t('notFound')}...`}
            aria-label={t('notFound')}
            className="w-full h-11 pl-10 pr-4 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </form>

        <Link href={`/${locale}`}>
          <Button size="lg">{t('backToHome')}</Button>
        </Link>
      </div>
    </div>
  )
}
