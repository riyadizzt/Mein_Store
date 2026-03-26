import { useTranslations } from 'next-intl'

export default function HomePage() {
  const t = useTranslations('home')

  return (
    <main className="min-h-screen">
      <section className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <h1 className="text-4xl font-bold mb-4">{t('welcome')}</h1>
        <p className="text-lg text-gray-600 max-w-xl">{t('subtitle')}</p>
      </section>
    </main>
  )
}
