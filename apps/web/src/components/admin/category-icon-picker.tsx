'use client'

import { Check } from 'lucide-react'
import { CATEGORY_ICONS, CategoryIcon } from '@/components/ui/category-icon'

const LABELS = {
  de: {
    title: 'Symbol',
    help: 'Wähle ein Symbol das neben dem Kategorienamen im Header angezeigt wird.',
    none: 'Automatisch (nach Slug)',
    clear: 'Kein Symbol',
    selected: 'Ausgewählt',
  },
  en: {
    title: 'Icon',
    help: 'Pick an icon that appears next to this category in the header.',
    none: 'Automatic (from slug)',
    clear: 'No icon',
    selected: 'Selected',
  },
  ar: {
    title: 'الرمز',
    help: 'اختر رمزاً يظهر بجانب اسم الفئة في الهيدر.',
    none: 'تلقائي (من الرابط)',
    clear: 'بدون رمز',
    selected: 'محدد',
  },
} as const

export function CategoryIconPicker({
  value,
  onChange,
  slug,
  locale,
}: {
  value: string | null
  onChange: (next: string | null) => void
  slug?: string
  locale: 'de' | 'en' | 'ar' | string
}) {
  const lang = (['de', 'en', 'ar'] as const).includes(locale as any)
    ? (locale as 'de' | 'en' | 'ar')
    : 'de'
  const L = LABELS[lang]

  return (
    <div className="mb-6">
      <label className="text-sm font-medium text-white/70 mb-2 block">{L.title}</label>

      {/* Auto / None row — first option, sits above the grid */}
      <button
        type="button"
        onClick={() => onChange(null)}
        className={`w-full flex items-center gap-3 px-3 py-2.5 mb-2 rounded-xl border text-sm transition-all ${
          value === null
            ? 'border-[#d4a853] bg-[#d4a853]/10 text-[#d4a853]'
            : 'border-white/[0.06] bg-[#1a1a2e] text-white/60 hover:text-white/80 hover:border-white/15'
        }`}
        aria-pressed={value === null}
      >
        <div className="h-8 w-8 rounded-lg bg-white/[0.04] flex items-center justify-center flex-shrink-0">
          <CategoryIcon slug={slug} className="h-4 w-4" />
        </div>
        <div className="flex-1 text-start min-w-0">
          <div className="font-medium truncate">{L.none}</div>
          <div className="text-[11px] text-white/40 truncate">{slug || '—'}</div>
        </div>
        {value === null && <Check className="h-4 w-4 flex-shrink-0" />}
      </button>

      {/* Icon grid */}
      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-7 gap-2">
        {CATEGORY_ICONS.map(({ key, Component, labels }) => {
          const selected = value === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(selected ? null : key)}
              className={`group relative flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border transition-all ${
                selected
                  ? 'border-[#d4a853] bg-[#d4a853]/10 text-[#d4a853]'
                  : 'border-white/[0.06] bg-[#1a1a2e] text-white/55 hover:text-white/90 hover:border-white/20'
              }`}
              title={labels[lang]}
              aria-pressed={selected}
              aria-label={labels[lang]}
            >
              <Component className="h-6 w-6" />
              <span className="text-[10px] leading-tight text-center truncate w-full">
                {labels[lang]}
              </span>
              {selected && (
                <span className="absolute top-1 right-1 rtl:right-auto rtl:left-1 h-4 w-4 rounded-full bg-[#d4a853] text-[#1a1a2e] flex items-center justify-center">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              )}
            </button>
          )
        })}
      </div>

      <p className="text-xs text-white/40 mt-2">{L.help}</p>
    </div>
  )
}
