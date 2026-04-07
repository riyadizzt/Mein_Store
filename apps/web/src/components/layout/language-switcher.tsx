'use client'

import { usePathname, useRouter } from 'next/navigation'
import { Globe } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

const LANGUAGES = [
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
]

export function LanguageSwitcher({ locale }: { locale: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const switchLocale = (newLocale: string) => {
    const segments = pathname.split('/')
    segments[1] = newLocale
    router.push(segments.join('/'))
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        className="p-2 text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen(!open)}
        aria-label="Language"
      >
        <Globe className="h-5 w-5" />
      </button>
      {open && (
        <div className="absolute right-0 rtl:right-auto rtl:left-0 mt-2 w-40 rounded-lg border bg-background shadow-lg py-1 z-50">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => switchLocale(lang.code)}
              className={`w-full px-4 py-2 text-sm text-start hover:bg-muted transition-colors flex items-center gap-2 ${
                locale === lang.code ? 'font-semibold text-primary' : ''
              }`}
            >
              <span>{lang.flag}</span>
              <span>{lang.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
