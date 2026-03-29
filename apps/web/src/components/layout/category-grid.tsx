'use client'

import { useLocale, useTranslations } from 'next-intl'
import Image from 'next/image'
import Link from 'next/link'
import { useCategories } from '@/hooks/use-categories'
import { ArrowRight } from 'lucide-react'

export function CategoryGrid() {
  const locale = useLocale()
  const t = useTranslations('home')
  const { data: categories, isLoading, isError } = useCategories()

  if (isError) return null

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="aspect-[3/4] rounded-2xl animate-shimmer" />
        ))}
      </div>
    )
  }

  if (!categories || categories.length === 0) return null

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
      {categories.map((cat: any, i: number) => {
        const name = cat.name
          ?? cat.translations?.find((tr: any) => tr.language === locale)?.name
          ?? cat.translations?.[0]?.name
          ?? cat.slug

        return (
          <Link
            key={cat.id}
            href={`/${locale}/products?department=${cat.slug}`}
            className="group relative block aspect-[3/4] rounded-2xl overflow-hidden animate-fade-up"
            style={{ animationDelay: `${i * 100}ms` }}
          >
            {/* Image */}
            {cat.imageUrl ? (
              <Image
                src={cat.imageUrl}
                alt={name}
                fill
                sizes="(max-width: 640px) 50vw, 25vw"
                className="object-cover transition-transform duration-700 ease-out group-hover:scale-110"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-muted to-muted/50" />
            )}

            {/* Gradient Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent transition-opacity duration-300 group-hover:from-black/80" />

            {/* Content */}
            <div className="absolute inset-0 flex flex-col justify-end p-5 sm:p-6">
              <h3 className="text-xl sm:text-2xl font-bold text-white leading-tight transition-transform duration-300 group-hover:-translate-y-1">
                {name}
              </h3>
              <div className="flex items-center gap-1.5 mt-2 text-white/70 text-sm opacity-0 translate-y-2 transition-all duration-300 group-hover:opacity-100 group-hover:translate-y-0">
                <span>{t('cta')}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
